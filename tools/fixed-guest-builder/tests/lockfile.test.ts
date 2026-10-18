import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAllowlist } from '../src/declaration.ts';
import { BuildError } from '../src/errors.ts';
import { checkCargoSources } from '../src/lockfile.ts';
import { tempDir } from './helpers/git.ts';

const allowlist = parseAllowlist({
  schemaVersion: 1,
  repositories: ['https://github.com/biomejs/biome'],
  dependencyRepositories: ['https://github.com/react/react'],
});
const COMMIT = 'a'.repeat(40);

const lock = (...sources: (string | undefined)[]) =>
  `version = 4\n${sources
    .map(
      (source, index) =>
        `[[package]]\nname = "p${index}"\nversion = "1.0.0"\n${source === undefined ? '' : `source = "${source}"\n`}`,
    )
    .join('\n')}`;

async function source(files: Record<string, string>): Promise<string> {
  const directory = await tempDir('fgb-lock-');
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(directory, name, '..'), { recursive: true });
    await writeFile(join(directory, name), content);
  }
  return directory;
}

async function errorCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

describe('checkCargoSources', () => {
  test('accepts crates.io, local packages and allowlisted git pinned to a commit', async () => {
    const directory = await source({
      'Cargo.lock': lock(
        undefined,
        'registry+https://github.com/rust-lang/crates.io-index',
        'sparse+https://index.crates.io/',
        `git+https://github.com/biomejs/biome?rev=x#${COMMIT}`,
        `git+https://github.com/react/react?rev=${COMMIT}#${COMMIT}`,
      ),
      '.cargo/config.toml': '[alias]\nx = "run"\n',
      'Cargo.toml':
        '[workspace]\n[patch.crates-io]\nlocal = { path = "crates/local" }\n',
    });
    const result = await checkCargoSources(directory, allowlist);
    expect(result.packages).toBe(5);
    expect(result.cargoLockSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('refuses a missing Cargo.lock', async () => {
    expect(
      await errorCode(
        checkCargoSources(await source({ 'Cargo.toml': '' }), allowlist),
      ),
    ).toBe('INVALID_INPUT');
  });

  test('refuses another registry and git outside the allowlist or without a full commit', async () => {
    for (const bad of [
      'registry+https://example.invalid/index',
      `git+https://github.com/someone/fork#${COMMIT}`,
      'git+https://github.com/biomejs/biome?branch=main#abc123',
    ]) {
      expect(
        await errorCode(
          checkCargoSources(
            await source({ 'Cargo.lock': lock(bad) }),
            allowlist,
          ),
        ),
      ).toBe('INVALID_INPUT');
    }
  });

  test('refuses source replacement and extra registries in .cargo config', async () => {
    for (const config of [
      '[source.crates-io]\nreplace-with = "mirror"\n',
      '[registries.mirror]\nindex = "https://example.invalid"\n',
      '[registry]\ndefault = "mirror"\n',
    ]) {
      const directory = await source({
        'Cargo.lock': lock(undefined),
        '.cargo/config': config,
      });
      expect(await errorCode(checkCargoSources(directory, allowlist))).toBe(
        'INVALID_INPUT',
      );
    }
  });

  test('refuses a patch from a repository outside the allowlist', async () => {
    const directory = await source({
      'Cargo.lock': lock(undefined),
      'Cargo.toml':
        '[patch.crates-io]\nserde = { git = "https://github.com/someone/serde" }\n',
    });
    expect(await errorCode(checkCargoSources(directory, allowlist))).toBe(
      'INVALID_INPUT',
    );
  });

  test('accepts a patch from an allowlisted repository', async () => {
    const directory = await source({
      'Cargo.lock': lock(undefined),
      '.cargo/config.toml':
        '[patch.crates-io]\nx = { git = "https://github.com/biomejs/biome.git" }\n',
    });
    expect((await checkCargoSources(directory, allowlist)).packages).toBe(1);
  });

  test('refuses malformed TOML and an empty package list', async () => {
    expect(
      await errorCode(
        checkCargoSources(
          await source({ 'Cargo.lock': '[[package' }),
          allowlist,
        ),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(
        checkCargoSources(
          await source({ 'Cargo.lock': 'version = 4\n' }),
          allowlist,
        ),
      ),
    ).toBe('INVALID_INPUT');
  });

  test('lists each allowlisted git dependency once, normalized', async () => {
    const directory = await source({
      'Cargo.lock': lock(
        `git+https://github.com/react/react?rev=${COMMIT}#${COMMIT}`,
        `git+https://github.com/React/react.git?rev=${COMMIT}#${COMMIT}`,
        'registry+https://github.com/rust-lang/crates.io-index',
      ),
    });
    const result = await checkCargoSources(directory, allowlist);
    expect(result.gitDependencies).toEqual([
      { repository: 'https://github.com/react/react', commit: COMMIT },
    ]);
  });
});
