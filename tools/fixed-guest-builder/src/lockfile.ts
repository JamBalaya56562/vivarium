import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Allowlist, normalizeRepositoryUrl } from './declaration.ts';
import { fail } from './errors.ts';
import { sha256File } from './source.ts';

const CRATES_IO = new Set([
  'registry+https://github.com/rust-lang/crates.io-index',
  'sparse+https://index.crates.io/',
]);
const GIT_SOURCE =
  /^git\+(https:\/\/github\.com\/[^?#]+)(?:\?[^#]*)?#([0-9a-f]{40})$/;

async function readOptional(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch(() => undefined);
}

function parseToml(text: string, label: string): Record<string, unknown> {
  try {
    return Bun.TOML.parse(text) as Record<string, unknown>;
  } catch {
    fail('INVALID_INPUT', `${label} is not valid TOML`);
  }
}

function allowedGitRepository(url: string, allowlist: Allowlist): boolean {
  try {
    const repository = normalizeRepositoryUrl(url);
    return (
      allowlist.repositories.includes(repository) ||
      allowlist.dependencyRepositories.includes(repository)
    );
  } catch {
    return false;
  }
}

function checkPatchTables(
  patch: unknown,
  allowlist: Allowlist,
  label: string,
): void {
  if (patch === undefined) return;
  if (typeof patch !== 'object' || patch === null)
    fail('INVALID_INPUT', `${label} [patch] must be a table`);
  for (const [registry, crates] of Object.entries(patch)) {
    if (typeof crates !== 'object' || crates === null)
      fail('INVALID_INPUT', `${label} [patch.${registry}] must be a table`);
    for (const [name, spec] of Object.entries(
      crates as Record<string, unknown>,
    )) {
      const entry = (
        typeof spec === 'object' && spec !== null ? spec : {}
      ) as Record<string, unknown>;
      if (
        typeof entry.path === 'string' &&
        entry.git === undefined &&
        entry.registry === undefined
      )
        continue;
      if (
        typeof entry.git === 'string' &&
        entry.registry === undefined &&
        allowedGitRepository(entry.git, allowlist)
      )
        continue;
      fail(
        'INVALID_INPUT',
        `${label} patches ${name} from a source outside the allowlist`,
      );
    }
  }
}

export interface LockfileCheck {
  cargoLockSha256: string;
  packages: number;
}

export async function checkCargoSources(
  directory: string,
  allowlist: Allowlist,
): Promise<LockfileCheck> {
  const lockPath = join(directory, 'Cargo.lock');
  const lockText = await readOptional(lockPath);
  if (lockText === undefined)
    fail('INVALID_INPUT', 'Cargo.lock is required; add one as a source patch');
  const lock = parseToml(lockText, 'Cargo.lock');
  const packages = lock.package;
  if (!Array.isArray(packages) || packages.length === 0)
    fail('INVALID_INPUT', 'Cargo.lock lists no packages');
  for (const entry of packages as Record<string, unknown>[]) {
    const source = entry.source;
    if (source === undefined) continue;
    if (typeof source !== 'string')
      fail('INVALID_INPUT', 'Cargo.lock source must be a string');
    if (CRATES_IO.has(source)) continue;
    const git = GIT_SOURCE.exec(source);
    if (git?.[1] !== undefined && allowedGitRepository(git[1], allowlist))
      continue;
    fail(
      'INVALID_INPUT',
      `Cargo.lock uses a source outside the allowlist: ${String(entry.name)}`,
    );
  }

  for (const name of ['config.toml', 'config']) {
    const text = await readOptional(join(directory, '.cargo', name));
    if (text === undefined) continue;
    const config = parseToml(text, `.cargo/${name}`);
    if (config.source !== undefined)
      fail('INVALID_INPUT', `.cargo/${name} replaces a source`);
    if (config.registries !== undefined || config.registry !== undefined)
      fail('INVALID_INPUT', `.cargo/${name} configures another registry`);
    checkPatchTables(config.patch, allowlist, `.cargo/${name}`);
  }

  const manifest = await readOptional(join(directory, 'Cargo.toml'));
  if (manifest !== undefined)
    checkPatchTables(
      parseToml(manifest, 'Cargo.toml').patch,
      allowlist,
      'Cargo.toml',
    );

  return {
    cargoLockSha256: await sha256File(lockPath),
    packages: packages.length,
  };
}
