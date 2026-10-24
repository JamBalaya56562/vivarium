#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Fetcher,
  fetchLimited,
} from '../../tools/fixed-guest-builder/src/http.ts';
import { FORMICARIUM_PIN_PATH } from './generate-recipes-index';
import {
  FORMICARIUM_PACKAGE,
  type FormicariumPin,
  NPM_REGISTRY,
  readNpmTarball,
  StageError,
  type StageErrorCode,
  sha256Hex,
  TRANSFER_LIMITS,
  tarballUrl,
} from './stage-formicarium-assets';

export const SOURCE_REPOSITORY =
  'https://github.com/aletheia-works/formicarium';

export type LsRemote = (url: string, refs: string[]) => string;

function fail(code: StageErrorCode, message: string): never {
  throw new StageError(code, message);
}

export const gitLsRemote: LsRemote = (url, refs) => {
  const proc = Bun.spawnSync(['git', 'ls-remote', url, ...refs]);
  if (proc.exitCode !== 0)
    fail(
      'ASSET_LOAD',
      `git ls-remote ${url} exited ${proc.exitCode}: ${proc.stderr.toString().trim()}`,
    );
  return proc.stdout.toString();
};

export function tagCommit(
  version: string,
  lsRemote: LsRemote = gitLsRemote,
): string {
  const tag = `refs/tags/v${version}`;
  const refs = new Map<string, string>();
  for (const line of lsRemote(SOURCE_REPOSITORY, [tag, `${tag}^{}`]).split(
    '\n',
  )) {
    const [sha, ref] = line.split('\t');
    if (sha && ref) refs.set(ref, sha);
  }
  const commit = refs.get(`${tag}^{}`) ?? refs.get(tag);
  if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit))
    fail('VERIFY_FAILED', `${SOURCE_REPOSITORY} has no tag v${version}`);
  return commit;
}

async function fetchBytes(
  url: string,
  limitBytes: number,
  fetcher: Fetcher | undefined,
): Promise<Uint8Array> {
  try {
    const result = await fetchLimited(url, {
      limitBytes,
      signal: AbortSignal.timeout(TRANSFER_LIMITS.fetchDeadlineMs),
      ...(fetcher === undefined ? {} : { fetcher }),
    });
    return result.bytes;
  } catch (error) {
    fail(
      'ASSET_LOAD',
      `${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

interface VersionDoc {
  version: string;
  tarball: string;
  integrity: string;
}

export async function fetchVersionDoc(
  version: string,
  fetcher?: Fetcher,
): Promise<VersionDoc> {
  const url = `${NPM_REGISTRY}/${FORMICARIUM_PACKAGE}/${encodeURIComponent(version)}`;
  const bytes = await fetchBytes(
    url,
    TRANSFER_LIMITS.maxMetadataBytes,
    fetcher,
  );
  let doc: {
    name?: unknown;
    version?: unknown;
    dist?: { tarball?: unknown; integrity?: unknown };
  };
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail('INVALID_INPUT', `${url} is not JSON`);
  }
  if (
    doc.name !== FORMICARIUM_PACKAGE ||
    typeof doc.version !== 'string' ||
    typeof doc.dist?.tarball !== 'string' ||
    typeof doc.dist.integrity !== 'string'
  )
    fail('INVALID_INPUT', `${url} is not a ${FORMICARIUM_PACKAGE} version`);
  if (version !== 'latest' && doc.version !== version)
    fail('INVALID_INPUT', `${url} describes ${doc.version}, not ${version}`);
  if (doc.dist.tarball !== tarballUrl(doc.version))
    fail(
      'VERIFY_FAILED',
      `${doc.version} is published at ${doc.dist.tarball}, not ${tarballUrl(doc.version)}`,
    );
  return {
    version: doc.version,
    tarball: doc.dist.tarball,
    integrity: doc.dist.integrity,
  };
}

export interface GenerateOptions {
  version?: string;
  fetcher?: Fetcher;
  lsRemote?: LsRemote;
}

export async function generatePin(
  options: GenerateOptions = {},
): Promise<FormicariumPin> {
  const doc = await fetchVersionDoc(
    options.version ?? 'latest',
    options.fetcher,
  );
  const tarball = await fetchBytes(
    doc.tarball,
    TRANSFER_LIMITS.maxDownloadBytes,
    options.fetcher,
  );
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  if (integrity !== doc.integrity)
    fail(
      'VERIFY_FAILED',
      `${doc.tarball} hashes to ${integrity}, not the registry's ${doc.integrity}`,
    );
  const files = readNpmTarball(tarball)
    .map((file) => ({ path: file.path, sha256: sha256Hex(file.bytes) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    schemaVersion: 1,
    package: FORMICARIUM_PACKAGE,
    packageVersion: doc.version,
    tarballSha256: sha256Hex(tarball),
    sourceCommit: tagCommit(doc.version, options.lsRemote),
    files,
  };
}

export function pinJson(pin: FormicariumPin): string {
  return `${JSON.stringify(pin, null, 2)}\n`;
}

export function changeSummary(
  before: Pick<FormicariumPin, 'packageVersion' | 'files'> | null,
  after: FormicariumPin,
): string {
  const release = `[v${after.packageVersion}](${SOURCE_REPOSITORY}/releases/tag/v${after.packageVersion})`;
  const lines = [
    before === null
      ? `Pins \`${FORMICARIUM_PACKAGE}\` at ${after.packageVersion} (${release}, source commit \`${after.sourceCommit}\`).`
      : `Moves \`${FORMICARIUM_PACKAGE}\` from ${before.packageVersion} to ${after.packageVersion} (${release}, source commit \`${after.sourceCommit}\`).`,
  ];
  const old = new Map(before?.files.map((file) => [file.path, file.sha256]));
  const added = after.files.filter((file) => !old.has(file.path));
  const kept = new Set(after.files.map((file) => file.path));
  const removed = [...old.keys()].filter((path) => !kept.has(path));
  const changed = after.files.filter(
    (file) => old.has(file.path) && old.get(file.path) !== file.sha256,
  ).length;
  for (const [label, paths] of [
    ['Added', added.map((file) => file.path)],
    ['Removed', removed],
  ] as const) {
    if (paths.length === 0) continue;
    lines.push('', `${label}:`, '');
    for (const path of paths) lines.push(`- \`${path}\``);
  }
  if (before !== null)
    lines.push(
      '',
      `${changed} of the ${after.files.length - added.length} kept files changed.`,
    );
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      pin: { type: 'string' },
    },
    strict: true,
  });
  const pinPath = values.pin ? resolve(values.pin) : FORMICARIUM_PIN_PATH;
  const current = existsSync(pinPath) ? readFileSync(pinPath, 'utf-8') : null;
  const pin = await generatePin(
    values.version ? { version: values.version } : {},
  );
  const text = pinJson(pin);
  if (text === current) {
    console.error(`${pinPath} already pins ${pin.packageVersion}.`);
    return;
  }
  await writeFile(pinPath, text);
  process.stdout.write(
    changeSummary(current === null ? null : JSON.parse(current), pin),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    process.exit(1);
  });
}
