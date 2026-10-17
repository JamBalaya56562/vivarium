import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BuildError } from '../src/errors.ts';
import { runProcess } from '../src/process.ts';
import { applyPatches, fetchSource, sha256File } from '../src/source.ts';
import { createUpstream, git, tempDir } from './helpers/git.ts';

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

async function fetchInto(url: string, commit: string) {
  const directory = join(await tempDir(), 'src');
  await fetchSource({
    repository: 'https://github.com/biomejs/biome',
    commit,
    directory,
    run: runProcess,
    cloneUrl: () => url,
  });
  return directory;
}

describe('fetchSource', () => {
  test('checks out a commit on a branch of the declared repository', async () => {
    const upstream = await createUpstream();
    const directory = await fetchInto(upstream.url, upstream.main);
    expect(await git(directory, 'rev-parse', 'HEAD')).toBe(upstream.main);
    expect(await readFile(join(directory, 'README'), 'utf8')).toBe('second\n');
  });

  test('accepts a commit reachable only from a tag', async () => {
    const upstream = await createUpstream();
    const directory = await fetchInto(upstream.url, upstream.tagged);
    expect(await git(directory, 'rev-parse', 'HEAD')).toBe(upstream.tagged);
  });

  test('refuses a commit the server stores but no ref of the repository reaches', async () => {
    const upstream = await createUpstream();
    expect(await errorCode(fetchInto(upstream.url, upstream.dangling))).toBe(
      'SOURCE_UNREACHABLE',
    );
  });

  test('refuses a commit that does not exist', async () => {
    const upstream = await createUpstream();
    expect(await errorCode(fetchInto(upstream.url, '0'.repeat(40)))).toBe(
      'SOURCE_UNREACHABLE',
    );
  });

  test('refuses when the clone itself fails', async () => {
    expect(
      await errorCode(
        fetchInto('file:///nonexistent/repository', '0'.repeat(40)),
      ),
    ).toBe('SOURCE_UNREACHABLE');
  });

  test('refuses a source that declares submodules', async () => {
    const upstream = await createUpstream({
      '.gitmodules':
        '[submodule "x"]\n\tpath = x\n\turl = https://example.invalid/x\n',
    });
    expect(await errorCode(fetchInto(upstream.url, upstream.main))).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('applyPatches', () => {
  async function setup() {
    const upstream = await createUpstream();
    const directory = await fetchInto(upstream.url, upstream.main);
    const root = await tempDir('fgb-patches-');
    const patch =
      '--- a/README\n+++ b/README\n@@ -1 +1 @@\n-second\n+patched\n';
    await writeFile(join(root, 'fix.patch'), patch);
    return {
      directory,
      root,
      sha256: await sha256File(join(root, 'fix.patch')),
    };
  }

  test('applies a patch whose SHA256 matches', async () => {
    const { directory, root, sha256 } = await setup();
    await applyPatches(
      directory,
      [{ name: 'fix', path: 'fix.patch', sha256 }],
      runProcess,
      root,
    );
    expect(await readFile(join(directory, 'README'), 'utf8')).toBe('patched\n');
  });

  test('refuses a patch whose SHA256 differs and leaves the tree unchanged', async () => {
    const { directory, root } = await setup();
    const code = await errorCode(
      applyPatches(
        directory,
        [{ name: 'fix', path: 'fix.patch', sha256: '0'.repeat(64) }],
        runProcess,
        root,
      ),
    );
    expect(code).toBe('VERIFY_FAILED');
    expect(await readFile(join(directory, 'README'), 'utf8')).toBe('second\n');
  });

  test('refuses a patch that does not apply and a path outside the patch root', async () => {
    const { directory, root } = await setup();
    await writeFile(
      join(root, 'bad.patch'),
      '--- a/README\n+++ b/README\n@@ -1 +1 @@\n-nope\n+x\n',
    );
    const sha256 = await sha256File(join(root, 'bad.patch'));
    expect(
      await errorCode(
        applyPatches(
          directory,
          [{ name: 'bad', path: 'bad.patch', sha256 }],
          runProcess,
          root,
        ),
      ),
    ).toBe('VERIFY_FAILED');
    expect(
      await errorCode(
        applyPatches(
          directory,
          [{ name: 'up', path: '../x.patch', sha256 }],
          runProcess,
          root,
        ),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(
        applyPatches(
          directory,
          [{ name: 'gone', path: 'gone.patch', sha256 }],
          runProcess,
          root,
        ),
      ),
    ).toBe('INVALID_INPUT');
  });
});
