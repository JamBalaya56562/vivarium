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
  repositories: [
    'https://github.com/biomejs/biome',
    'https://github.com/jambalaya56562/biome',
  ],
});

const ACCEPTED = {
  commit: '3'.repeat(40),
  versionOrName: '3'.repeat(40),
  buildKey: '4'.repeat(64),
  elfSha256: '1'.repeat(64),
  buildInfoSha256: '2'.repeat(64),
};

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

async function recipe(...guests: Record<string, unknown>[]): Promise<string> {
  const path = join(await tempDir(), 'recipe.json');
  await writeFile(
    path,
    JSON.stringify({
      schema_version: 1,
      language: 'shell',
      expected_runtime: 'formicarium',
      guests,
    }),
  );
  return path;
}

function guest(role: string, commit: string, extra = {}) {
  return {
    role,
    tool: 'biome',
    repository:
      role === 'fix'
        ? 'https://github.com/jambalaya56562/biome'
        : 'https://github.com/biomejs/biome',
    commit,
    fixture: 'biome-migrate-prettier-override',
    reference: { branch: 'main' },
    ...extra,
  };
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
  test('moves only the commit of the chosen role and keeps accepted', async () => {
    const upstream = await createUpstream();
    const path = await recipe(
      guest('baseline', upstream.tagged, {
        reference: { branch: 'main', pr: 'biomejs/biome#1' },
        accepted: ACCEPTED,
      }),
      guest('fix', upstream.tagged, { accepted: ACCEPTED }),
    );
    const record = await bumpGuest({
      recipePath: path,
      role: 'baseline',
      allowlist,
      run: runProcess,
      workDirectory: await tempDir(),
      cloneUrl: () => upstream.url,
      now: () => new Date('2026-10-17T00:00:00Z'),
    });
    expect(record).toEqual({
      role: 'baseline',
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      branch: 'main',
      previousCommit: upstream.tagged,
      commit: upstream.main,
      resolvedAt: '2026-10-17T00:00:00.000Z',
    });
    const [baseline, fix] = JSON.parse(await readFile(path, 'utf8')).guests;
    expect(baseline.commit).toBe(upstream.main);
    expect(baseline.accepted).toEqual(ACCEPTED);
    expect(baseline.reference).toEqual({
      branch: 'main',
      pr: 'biomejs/biome#1',
    });
    expect(fix.commit).toBe(upstream.tagged);
    expect(fix.accepted).toEqual(ACCEPTED);
  });

  test('moves the fix guest from its own repository', async () => {
    const upstream = await createUpstream();
    const path = await recipe(
      guest('baseline', upstream.main),
      guest('fix', upstream.tagged),
    );
    const repositories: string[] = [];
    const record = await bumpGuest({
      recipePath: path,
      role: 'fix',
      allowlist,
      run: runProcess,
      workDirectory: await tempDir(),
      cloneUrl: (repository) => {
        repositories.push(repository);
        return upstream.url;
      },
    });
    expect(record?.role).toBe('fix');
    expect(record?.repository).toBe('https://github.com/jambalaya56562/biome');
    expect(new Set(repositories)).toEqual(
      new Set(['https://github.com/jambalaya56562/biome']),
    );
    const [baseline, fix] = JSON.parse(await readFile(path, 'utf8')).guests;
    expect(fix.commit).toBe(upstream.main);
    expect(baseline.commit).toBe(upstream.main);
  });

  test('changes nothing when the guest is already at the tip', async () => {
    const upstream = await createUpstream();
    const path = await recipe(guest('baseline', upstream.main));
    const before = await readFile(path, 'utf8');
    expect(
      await bumpGuest({
        recipePath: path,
        role: 'baseline',
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
    const path = await recipe(
      guest('baseline', upstream.tagged, {
        reference: { pr: 'biomejs/biome#1' },
      }),
    );
    const before = await readFile(path, 'utf8');
    expect(
      await errorCode(
        bumpGuest({
          recipePath: path,
          role: 'baseline',
          allowlist,
          run: runProcess,
          workDirectory: await tempDir(),
          cloneUrl: () => upstream.url,
        }),
      ),
    ).toBe('INVALID_INPUT');
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  test('refuses an unknown role, a missing role, a repeated role and a repository outside the allowlist', async () => {
    const upstream = await createUpstream();
    const options = {
      allowlist,
      run: runProcess,
      workDirectory: await tempDir(),
      cloneUrl: () => upstream.url,
    };
    const both = await recipe(guest('baseline', upstream.tagged));
    expect(
      await errorCode(
        bumpGuest({ ...options, recipePath: both, role: 'candidate' }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(bumpGuest({ ...options, recipePath: both, role: 'fix' })),
    ).toBe('INVALID_INPUT');
    const twice = await recipe(
      guest('fix', upstream.tagged),
      guest('fix', upstream.tagged),
    );
    expect(
      await errorCode(
        bumpGuest({ ...options, recipePath: twice, role: 'fix' }),
      ),
    ).toBe('INVALID_INPUT');
    const outside = await recipe(
      guest('baseline', upstream.tagged, {
        repository: 'https://github.com/someone/biome',
      }),
    );
    expect(
      await errorCode(
        bumpGuest({ ...options, recipePath: outside, role: 'baseline' }),
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
    const path = await recipe(guest('baseline', upstream.tagged));
    const before = Date.now();
    const record = await bumpGuest({
      recipePath: path,
      role: 'baseline',
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
