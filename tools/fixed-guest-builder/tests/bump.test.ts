import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bumpGuest, resolveBranch } from '../src/bump.ts';
import { parseAllowlist } from '../src/declaration.ts';
import { BuildError } from '../src/errors.ts';
import { runProcess } from '../src/process.ts';
import { createUpstream, tempDir } from './helpers/git.ts';

const allowlist = parseAllowlist({
  schemaVersion: 1,
  repositories: ['https://github.com/biomejs/biome'],
});

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

async function recipe(guest: Record<string, unknown>): Promise<string> {
  const path = join(await tempDir(), 'recipe.json');
  await writeFile(
    path,
    JSON.stringify({ schema_version: 1, language: 'rust', guests: [guest] }),
  );
  return path;
}

describe('resolveBranch', () => {
  test('returns the tip of the branch in the declared repository', async () => {
    const upstream = await createUpstream();
    expect(
      await resolveBranch({
        repository: 'https://github.com/biomejs/biome',
        branch: 'main',
        run: runProcess,
        cloneUrl: () => upstream.url,
      }),
    ).toBe(upstream.main);
  });

  test('refuses a branch that does not exist and an unsafe branch name', async () => {
    const upstream = await createUpstream();
    const options = {
      repository: 'https://github.com/biomejs/biome',
      run: runProcess,
      cloneUrl: () => upstream.url,
    };
    expect(
      await errorCode(resolveBranch({ ...options, branch: 'fork-only' })),
    ).toBe('SOURCE_UNREACHABLE');
    expect(
      await errorCode(resolveBranch({ ...options, branch: '--upload-pack=x' })),
    ).toBe('INVALID_INPUT');
    expect(await errorCode(resolveBranch({ ...options, branch: 'a..b' }))).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('bumpGuest', () => {
  test('moves the guest to the branch tip, records how, and drops the old digests', async () => {
    const upstream = await createUpstream();
    const path = await recipe({
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      commit: upstream.tagged,
      fixture: 'biome-12265',
      reference: { branch: 'main', pr: 'biomejs/biome#1' },
      elfSha256: '1'.repeat(64),
      buildInfoSha256: '2'.repeat(64),
    });
    const record = await bumpGuest({
      recipePath: path,
      tool: 'biome',
      allowlist,
      run: runProcess,
      workDirectory: await tempDir(),
      cloneUrl: () => upstream.url,
      now: () => new Date('2026-10-17T00:00:00Z'),
    });
    expect(record).toEqual({
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      branch: 'main',
      previousCommit: upstream.tagged,
      commit: upstream.main,
      resolvedAt: '2026-10-17T00:00:00.000Z',
    });
    const guest = JSON.parse(await readFile(path, 'utf8')).guests[0];
    expect(guest.commit).toBe(upstream.main);
    expect(guest.elfSha256).toBeUndefined();
    expect(guest.reference).toEqual({ branch: 'main', pr: 'biomejs/biome#1' });
  });

  test('changes nothing when the guest is already at the tip', async () => {
    const upstream = await createUpstream();
    const guest = {
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      commit: upstream.main,
      fixture: 'f',
      reference: { branch: 'main' },
    };
    const path = await recipe(guest);
    const before = await readFile(path, 'utf8');
    expect(
      await bumpGuest({
        recipePath: path,
        tool: 'biome',
        allowlist,
        run: runProcess,
        workDirectory: await tempDir(),
        cloneUrl: () => upstream.url,
      }),
    ).toBeNull();
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  test('does not move a guest that only names a PR', async () => {
    const upstream = await createUpstream();
    const path = await recipe({
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      commit: upstream.tagged,
      fixture: 'f',
      reference: { pr: 'biomejs/biome#1' },
    });
    const before = await readFile(path, 'utf8');
    expect(
      await errorCode(
        bumpGuest({
          recipePath: path,
          tool: 'biome',
          allowlist,
          run: runProcess,
          workDirectory: await tempDir(),
          cloneUrl: () => upstream.url,
        }),
      ),
    ).toBe('INVALID_INPUT');
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  test('refuses a repository outside the allowlist and a tool declared twice', async () => {
    const upstream = await createUpstream();
    const outside = await recipe({
      tool: 'biome',
      repository: 'https://github.com/someone/biome',
      commit: upstream.tagged,
      fixture: 'f',
      reference: { branch: 'main' },
    });
    expect(
      await errorCode(
        bumpGuest({
          recipePath: outside,
          tool: 'biome',
          allowlist,
          run: runProcess,
          workDirectory: await tempDir(),
        }),
      ),
    ).toBe('INVALID_INPUT');
    const twice = join(await tempDir(), 'recipe.json');
    const guest = {
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      commit: upstream.tagged,
      fixture: 'f',
      reference: { branch: 'main' },
    };
    await writeFile(twice, JSON.stringify({ guests: [guest, guest] }));
    expect(
      await errorCode(
        bumpGuest({
          recipePath: twice,
          tool: 'biome',
          allowlist,
          run: runProcess,
          workDirectory: await tempDir(),
        }),
      ),
    ).toBe('INVALID_INPUT');
  });
});

describe('defaults', () => {
  test('resolveBranch uses the repository itself as the URL when no cloneUrl is given', async () => {
    const upstream = await createUpstream();
    expect(
      await resolveBranch({
        repository: upstream.url,
        branch: 'main',
        run: runProcess,
      }),
    ).toBe(upstream.main);
  });

  test('bumpGuest stamps the resolution time with the current clock by default', async () => {
    const upstream = await createUpstream();
    const path = await recipe({
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      commit: upstream.tagged,
      fixture: 'f',
      reference: { branch: 'main' },
    });
    const before = Date.now();
    const record = await bumpGuest({
      recipePath: path,
      tool: 'biome',
      allowlist,
      run: runProcess,
      workDirectory: await tempDir(),
      cloneUrl: () => upstream.url,
    });
    const stamped = Date.parse(record?.resolvedAt ?? '');
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
