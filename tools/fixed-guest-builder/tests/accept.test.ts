import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptBuild, parsePublishedBuild } from '../src/accept.ts';
import { BuildError } from '../src/errors.ts';

const BUILD = {
  tool: 'biome',
  repository: 'https://github.com/jambalaya56562/biome',
  commit: 'c'.repeat(40),
  versionOrName: 'c'.repeat(40),
  buildKey: 'a'.repeat(64),
  elfSha256: 'e'.repeat(64),
  buildInfoSha256: 'b'.repeat(64),
};

const ACCEPTED = {
  commit: BUILD.commit,
  versionOrName: BUILD.versionOrName,
  buildKey: BUILD.buildKey,
  elfSha256: BUILD.elfSha256,
  buildInfoSha256: BUILD.buildInfoSha256,
};

function guest(role: string, overrides: Record<string, unknown> = {}) {
  return {
    role,
    tool: 'biome',
    repository: BUILD.repository,
    commit: BUILD.commit,
    fixture: 'f',
    ...overrides,
  };
}

async function layer1(recipes: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fgb-accept-'));
  for (const [slug, recipe] of Object.entries(recipes)) {
    await mkdir(join(root, slug), { recursive: true });
    if (recipe !== null)
      await writeFile(
        join(root, slug, 'recipe.json'),
        typeof recipe === 'string' ? recipe : JSON.stringify(recipe),
      );
  }
  return root;
}

async function read(root: string, slug: string) {
  return JSON.parse(await readFile(join(root, slug, 'recipe.json'), 'utf8'));
}

describe('parsePublishedBuild', () => {
  test('takes a complete build and refuses a missing or malformed field', () => {
    expect(parsePublishedBuild(BUILD)).toEqual(BUILD);
    for (const [key, value] of [
      ['tool', ''],
      ['commit', 'abc'],
      ['buildKey', 'Z'.repeat(64)],
      ['elfSha256', undefined],
    ] as const)
      expect(() => parsePublishedBuild({ ...BUILD, [key]: value })).toThrow(
        BuildError,
      );
    expect(() => parsePublishedBuild(null)).toThrow(BuildError);
  });
});

describe('acceptBuild', () => {
  test('accepts the build in every guest that declares its source, and only there', async () => {
    const root = await layer1({
      _shared: null,
      'new-recipe': {
        guests: [guest('baseline', { commit: 'd'.repeat(40) }), guest('fix')],
      },
      'moved-recipe': {
        guests: [
          guest('fix', { accepted: { ...ACCEPTED, buildKey: 'f'.repeat(64) } }),
        ],
      },
      'other-tool': { guests: [guest('fix', { tool: 'aube' })] },
      'other-repo': {
        guests: [
          guest('fix', { repository: 'https://github.com/biomejs/biome' }),
        ],
      },
      'no-guests': { schema_version: 1 },
      'no-recipe': null,
    });
    const changes = await acceptBuild({ layer1Directory: root, build: BUILD });
    expect(changes).toEqual([
      { recipe: 'moved-recipe', role: 'fix', previousBuildKey: 'f'.repeat(64) },
      { recipe: 'new-recipe', role: 'fix', previousBuildKey: null },
    ]);
    const created = await read(root, 'new-recipe');
    expect(created.guests[1].accepted).toEqual(ACCEPTED);
    expect(Object.keys(created.guests[1].accepted)).toEqual(
      Object.keys(ACCEPTED),
    );
    expect(created.guests[0].accepted).toBeUndefined();
    expect((await read(root, 'moved-recipe')).guests[0].accepted).toEqual(
      ACCEPTED,
    );
    expect((await read(root, 'other-tool')).guests[0].accepted).toBeUndefined();
    expect((await read(root, 'other-repo')).guests[0].accepted).toBeUndefined();
  });

  test('leaves a recipe that already accepts the build untouched', async () => {
    const original = `${JSON.stringify({ guests: [guest('fix', { accepted: ACCEPTED })] })}\n`;
    const root = await layer1({ done: original });
    expect(await acceptBuild({ layer1Directory: root, build: BUILD })).toEqual(
      [],
    );
    expect(await readFile(join(root, 'done', 'recipe.json'), 'utf8')).toBe(
      original,
    );
  });
});
