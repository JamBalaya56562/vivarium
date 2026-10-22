import { fail } from './errors.ts';
import {
  buildKey,
  canonicalJson,
  type DependencyIdentity,
  type PatchIdentity,
  sha256Hex,
} from './key.ts';

export const MAX_ELF_BYTES = 134_217_728;
export const MAX_METADATA_BYTES = 1_048_576;
export const MAX_CATALOG_BYTES = 4_194_304;
export const MAX_LICENSE_BYTES = 4_194_304;
export const LICENSE_ASSET = 'LICENSE';
export const NOTICES_ASSET = 'THIRD_PARTY_NOTICES.md';
const LICENSE_ASSETS = [LICENSE_ASSET, NOTICES_ASSET] as const;

export interface LicenseFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface GuestBuildInfo {
  schemaVersion: 1;
  tool: string;
  versionOrName: string;
  source: { repository: string; commit: string };
  target: 'x86_64-unknown-linux-musl';
  rustc: string | null;
  sourcePatches: readonly PatchIdentity[];
  dependencies: readonly DependencyIdentity[];
  builderHash: string;
  buildKey: string;
  elfSha256: string;
  licenseFiles?: readonly LicenseFile[];
  [extra: string]: unknown;
}

export interface CatalogEntry {
  tool: string;
  versionOrName: string;
  url: string;
  format: 'elf';
  downloadSha256: string;
  downloadBytes: number;
  elfBytes: number;
  buildInfo: GuestBuildInfo;
  buildInfoSha256: string;
}

export interface GuestCatalog {
  schemaVersion: 1;
  catalogId: string;
  defaults: Record<string, string>;
  entries: CatalogEntry[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const encoder = new TextEncoder();

// JSON.parse silently keeps the last of duplicated keys, so the text is walked
// first to refuse a repeated key, including one that differs only in escaping.
export function parseUniqueJson(
  bytes: Uint8Array,
  limit: number,
  label: string,
): unknown {
  if (bytes.byteLength > limit)
    fail('LIMIT_EXCEEDED', `${label} is larger than ${limit} bytes`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('INVALID_INPUT', `${label} is not UTF-8`);
  }
  let at = 0;
  const space = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at] as string)) at += 1;
  };
  const string = (): string => {
    const start = at;
    at += 1;
    while (at < text.length && text[at] !== '"')
      at += text[at] === '\\' ? 2 : 1;
    at += 1;
    try {
      return JSON.parse(text.slice(start, at)) as string;
    } catch {
      fail('INVALID_INPUT', `${label} has an invalid string`);
    }
  };
  const value = (depth: number): void => {
    if (depth > 64) fail('INVALID_INPUT', `${label} nests too deeply`);
    space();
    const char = text[at];
    if (char === '{') {
      at += 1;
      const keys = new Set<string>();
      space();
      if (text[at] === '}') {
        at += 1;
        return;
      }
      for (;;) {
        space();
        if (text[at] !== '"')
          fail('INVALID_INPUT', `${label} needs an object key`);
        const key = string();
        if (keys.has(key))
          fail(
            'INVALID_INPUT',
            `${label} repeats the key ${JSON.stringify(key)}`,
          );
        keys.add(key);
        space();
        if (text[at] !== ':') fail('INVALID_INPUT', `${label} needs a colon`);
        at += 1;
        value(depth + 1);
        space();
        const next = text[at];
        at += 1;
        if (next === '}') return;
        if (next !== ',') fail('INVALID_INPUT', `${label} needs a comma or }`);
      }
    }
    if (char === '[') {
      at += 1;
      space();
      if (text[at] === ']') {
        at += 1;
        return;
      }
      for (;;) {
        value(depth + 1);
        space();
        const next = text[at];
        at += 1;
        if (next === ']') return;
        if (next !== ',') fail('INVALID_INPUT', `${label} needs a comma or ]`);
      }
    }
    if (char === '"') {
      string();
      return;
    }
    const start = at;
    while (at < text.length && !/[\s,\]}]/.test(text[at] as string)) at += 1;
    if (at === start) fail('INVALID_INPUT', `${label} needs a value`);
  };
  value(0);
  space();
  if (at !== text.length) fail('INVALID_INPUT', `${label} has trailing input`);
  try {
    return JSON.parse(text);
  } catch {
    fail('INVALID_INPUT', `${label} is not valid JSON`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('INVALID_INPUT', `${label} must be an object`);
  return value as Record<string, unknown>;
}

function name(value: unknown, max: number, label: string): string {
  if (
    typeof value !== 'string' ||
    !NAME.test(value) ||
    encoder.encode(value).length > max
  )
    fail('INVALID_INPUT', `${label} is not a valid identifier`);
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    fail('INVALID_INPUT', `${label} must be a SHA256`);
  return value;
}

function sourceIdentity(
  value: unknown,
  label: string,
): { repository: string; commit: string } {
  const item = record(value, label);
  let url: URL;
  try {
    url = new URL(String(item.repository));
  } catch {
    fail('INVALID_INPUT', `${label} repository is not a URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    fail('INVALID_INPUT', `${label} repository must be public HTTPS`);
  if (typeof item.commit !== 'string' || !COMMIT.test(item.commit))
    fail('INVALID_INPUT', `${label} needs a full commit`);
  return { repository: String(item.repository), commit: item.commit };
}

export function validateBuildInfo(value: unknown): GuestBuildInfo {
  const info = record(value, 'build-info');
  if (info.schemaVersion !== 1)
    fail('INVALID_INPUT', 'build-info schemaVersion must be 1');
  name(info.tool, 64, 'build-info tool');
  name(info.versionOrName, 128, 'build-info versionOrName');
  sourceIdentity(info.source, 'build-info source');
  if (info.target !== 'x86_64-unknown-linux-musl')
    fail(
      'INVALID_INPUT',
      'build-info target must be x86_64-unknown-linux-musl',
    );
  if (
    !(
      info.rustc === null ||
      (typeof info.rustc === 'string' && info.rustc.length > 0)
    )
  )
    fail('INVALID_INPUT', 'build-info rustc must be a string or null');
  if (!Array.isArray(info.sourcePatches) || !Array.isArray(info.dependencies))
    fail('INVALID_INPUT', 'build-info needs sourcePatches and dependencies');
  const patches = new Set<string>();
  for (const patch of info.sourcePatches) {
    const item = record(patch, 'build-info patch');
    if (typeof item.name !== 'string' || item.name.length === 0)
      fail('INVALID_INPUT', 'build-info patch needs a name');
    sha(item.sha256, 'build-info patch sha256');
    if (patches.has(item.name))
      fail('INVALID_INPUT', 'build-info repeats a patch');
    patches.add(item.name);
  }
  for (const dependency of info.dependencies) {
    const item = record(dependency, 'build-info dependency');
    name(item.tool, 64, 'build-info dependency tool');
    sourceIdentity(item, 'build-info dependency');
    sha(item.digest, 'build-info dependency digest');
  }
  sha(info.builderHash, 'build-info builderHash');
  sha(info.buildKey, 'build-info buildKey');
  sha(info.elfSha256, 'build-info elfSha256');
  if (info.licenseFiles !== undefined) {
    if (
      !Array.isArray(info.licenseFiles) ||
      info.licenseFiles.length !== LICENSE_ASSETS.length
    )
      fail('INVALID_INPUT', 'build-info licenseFiles must list two files');
    for (const [index, raw] of info.licenseFiles.entries()) {
      const file = record(raw, 'build-info license file');
      if (file.name !== LICENSE_ASSETS[index])
        fail(
          'INVALID_INPUT',
          `build-info licenseFiles must be ${LICENSE_ASSETS.join(' and ')}`,
        );
      sha(file.sha256, 'build-info license file sha256');
      if (
        typeof file.bytes !== 'number' ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes <= 0 ||
        file.bytes > MAX_LICENSE_BYTES
      )
        fail(
          'INVALID_INPUT',
          'build-info license file bytes must be within the limit',
        );
    }
  }
  const typed = info as unknown as GuestBuildInfo;
  if (typed.rustc === null)
    fail('INVALID_INPUT', 'builder build-info records the actual rustc');
  const expected = buildKey({
    tool: typed.tool,
    repository: typed.source.repository,
    commit: typed.source.commit,
    target: typed.target,
    rustc: typed.rustc,
    sourcePatches: typed.sourcePatches,
    dependencies: typed.dependencies,
    builderHash: typed.builderHash,
  });
  if (expected !== typed.buildKey)
    fail('VERIFY_FAILED', 'build-info buildKey does not match its own inputs');
  return typed;
}

export function validateCatalog(value: unknown): GuestCatalog {
  const catalog = record(value, 'catalog');
  if (catalog.schemaVersion !== 1)
    fail('INVALID_INPUT', 'catalog schemaVersion must be 1');
  if (typeof catalog.catalogId !== 'string' || catalog.catalogId.length === 0)
    fail('INVALID_INPUT', 'catalog needs a catalogId');
  record(catalog.defaults, 'catalog defaults');
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0)
    fail('INVALID_INPUT', 'catalog needs entries');
  for (const raw of catalog.entries) {
    const entry = record(raw, 'catalog entry');
    name(entry.tool, 64, 'catalog tool');
    name(entry.versionOrName, 128, 'catalog versionOrName');
    if (typeof entry.url !== 'string' || !entry.url.startsWith('https://'))
      fail('INVALID_INPUT', 'catalog url must be HTTPS');
    if (entry.format !== 'elf')
      fail('INVALID_INPUT', 'builder catalog entries are ELF');
    if (entry.archiveEntry !== undefined)
      fail('INVALID_INPUT', 'archiveEntry is not allowed for ELF entries');
    sha(entry.downloadSha256, 'catalog downloadSha256');
    sha(entry.buildInfoSha256, 'catalog buildInfoSha256');
    for (const field of ['downloadBytes', 'elfBytes'] as const) {
      const bytes = entry[field];
      if (
        typeof bytes !== 'number' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        bytes > MAX_ELF_BYTES
      )
        fail('INVALID_INPUT', `catalog ${field} must be within the ELF limit`);
    }
    validateBuildInfo(entry.buildInfo);
  }
  return catalog as unknown as GuestCatalog;
}

export interface ArtifactSet {
  elf: Uint8Array;
  buildInfo: Uint8Array;
  catalog: Uint8Array;
}

export interface VerifiedSet {
  buildInfo: GuestBuildInfo;
  catalog: GuestCatalog;
  elfSha256: string;
  buildInfoSha256: string;
  catalogSha256: string;
}

export function verifyArtifactSet(
  files: ArtifactSet,
  expected: {
    buildKey: string;
    tool: string;
    repository: string;
    commit: string;
  },
): VerifiedSet {
  if (files.elf.byteLength > MAX_ELF_BYTES)
    fail('LIMIT_EXCEEDED', 'ELF is larger than the limit');
  const parsedInfo = parseUniqueJson(
    files.buildInfo,
    MAX_METADATA_BYTES,
    'build-info',
  );
  // formicarium hashes the canonical form, so any other spelling breaks the digest.
  if (new TextDecoder().decode(files.buildInfo) !== canonicalJson(parsedInfo))
    fail('VERIFY_FAILED', 'build-info is not in canonical JSON form');
  const buildInfo = validateBuildInfo(parsedInfo);
  const catalog = validateCatalog(
    parseUniqueJson(files.catalog, MAX_CATALOG_BYTES, 'catalog'),
  );
  const elfSha256 = sha256Hex(files.elf);
  const buildInfoSha256 = sha256Hex(files.buildInfo);
  if (buildInfo.buildKey !== expected.buildKey)
    fail('VERIFY_FAILED', 'build-info is for another key');
  if (
    buildInfo.tool !== expected.tool ||
    buildInfo.source.repository !== expected.repository ||
    buildInfo.source.commit !== expected.commit
  )
    fail('VERIFY_FAILED', 'build-info is for another source');
  if (buildInfo.elfSha256 !== elfSha256)
    fail('VERIFY_FAILED', 'ELF differs from build-info');
  const entry = catalog.entries.find(
    (item) => item.buildInfo.buildKey === expected.buildKey,
  );
  if (entry === undefined || catalog.entries.length !== 1)
    fail('VERIFY_FAILED', 'catalog does not hold exactly this key');
  if (
    entry.buildInfoSha256 !== buildInfoSha256 ||
    entry.downloadSha256 !== elfSha256 ||
    entry.elfBytes !== files.elf.byteLength ||
    entry.downloadBytes !== files.elf.byteLength
  )
    fail('VERIFY_FAILED', 'catalog entry differs from the files');
  return {
    buildInfo,
    catalog,
    elfSha256,
    buildInfoSha256,
    catalogSha256: sha256Hex(files.catalog),
  };
}

export interface GuestSet extends ArtifactSet {
  license: Uint8Array;
  notices: Uint8Array;
}

export interface VerifiedGuestSet extends VerifiedSet {
  licenseSha256: string;
  noticesSha256: string;
}

export function licenseFilesFor(
  license: Uint8Array,
  notices: Uint8Array,
): LicenseFile[] {
  return [
    {
      name: LICENSE_ASSET,
      sha256: sha256Hex(license),
      bytes: license.byteLength,
    },
    {
      name: NOTICES_ASSET,
      sha256: sha256Hex(notices),
      bytes: notices.byteLength,
    },
  ];
}

export function verifyGuestSet(
  files: GuestSet,
  expected: Parameters<typeof verifyArtifactSet>[1],
): VerifiedGuestSet {
  const verified = verifyArtifactSet(files, expected);
  const listed = verified.buildInfo.licenseFiles;
  if (listed === undefined)
    fail('VERIFY_FAILED', 'build-info lists no license files');
  if (
    files.license.byteLength > MAX_LICENSE_BYTES ||
    files.notices.byteLength > MAX_LICENSE_BYTES
  )
    fail('LIMIT_EXCEEDED', 'a license file is larger than the limit');
  const actual = licenseFilesFor(files.license, files.notices);
  if (canonicalJson(listed) !== canonicalJson(actual))
    fail('VERIFY_FAILED', 'license files differ from build-info');
  return {
    ...verified,
    licenseSha256: actual[0]?.sha256 as string,
    noticesSha256: actual[1]?.sha256 as string,
  };
}

export function makeCatalog(
  buildInfo: GuestBuildInfo,
  buildInfoBytes: Uint8Array,
  elf: Uint8Array,
  url: string,
): GuestCatalog {
  return {
    schemaVersion: 1,
    catalogId: `guest-${buildInfo.tool}-${buildInfo.buildKey}`,
    defaults: { [buildInfo.tool]: buildInfo.versionOrName },
    entries: [
      {
        tool: buildInfo.tool,
        versionOrName: buildInfo.versionOrName,
        url,
        format: 'elf',
        downloadSha256: sha256Hex(elf),
        downloadBytes: elf.byteLength,
        elfBytes: elf.byteLength,
        buildInfo,
        buildInfoSha256: sha256Hex(buildInfoBytes),
      },
    ],
  };
}
