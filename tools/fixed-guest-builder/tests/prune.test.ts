import { describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../src/cli.ts';
import { BuildError } from '../src/errors.ts';
import { createGitHubApi } from '../src/github.ts';
import { runProcess } from '../src/process.ts';
import {
  acceptedKeys,
  guestKey,
  historyLookup,
  pruneReleases,
  referencesInOpenPulls,
  referencesOnMain,
  renderPruneSummary,
} from '../src/prune.ts';
import { FakeGitHub } from './helpers/fake-github.ts';
import { git, tempDir } from './helpers/git.ts';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const KEY_C = 'c'.repeat(64);
const KEY_D = 'd'.repeat(64);
const NOW = new Date('2026-10-26T00:00:00Z');

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

function recipe(...keys: string[]): string {
  return `${JSON.stringify(
    {
      guests: keys.map((buildKey, index) => ({
        role: index === 0 ? 'baseline' : 'fix',
        accepted: { buildKey },
      })),
    },
    null,
    2,
  )}\n`;
}

async function layer1(recipes: Record<string, string>): Promise<string> {
  const directory = await tempDir('fgb-layer1-');
  for (const [name, text] of Object.entries(recipes)) {
    await mkdir(join(directory, name), { recursive: true });
    await writeFile(join(directory, name, 'recipe.json'), text);
  }
  return directory;
}

function releases(api: FakeGitHub, entries: [string, string][]) {
  for (const [tag, publishedAt] of entries) {
    const release = api.addPublished(tag, {});
    api.publishedAt.set(release.id, publishedAt);
    api.tags.add(tag);
  }
}

describe('guest keys', () => {
  test('come only from guest Release tags with a full key', () => {
    expect(guestKey(`guest-biome-${KEY_A}`)).toBe(KEY_A);
    expect(guestKey(`guest-cargo-deny-${KEY_A}`)).toBe(KEY_A);
    expect(guestKey('v0.6.0')).toBeNull();
    expect(guestKey(`guest-biome-${KEY_A.slice(1)}`)).toBeNull();
    expect(guestKey(`guest--${KEY_A}`)).toBeNull();
  });

  test('come from each guest accepted block', () => {
    expect(acceptedKeys(recipe(KEY_A, KEY_B))).toEqual([KEY_A, KEY_B]);
    expect(acceptedKeys('{"guests":[{"role":"baseline"},null]}')).toEqual([]);
    expect(acceptedKeys('{"runtime":"pyodide"}')).toEqual([]);
  });
});

describe('references', () => {
  test('read every recipe on main and skip shared and non-recipe directories', async () => {
    const directory = await layer1({
      one: recipe(KEY_A, KEY_B),
      two: recipe(KEY_A),
      _shared: recipe(KEY_C),
    });
    await mkdir(join(directory, 'empty'));
    await writeFile(join(directory, 'README.md'), KEY_D);
    expect(Object.fromEntries(await referencesOnMain(directory))).toEqual({
      [KEY_A]: ['main:one', 'main:two'],
      [KEY_B]: ['main:one'],
    });
    expect(await errorCode(referencesOnMain(join(directory, 'missing')))).toBe(
      'INVALID_INPUT',
    );
    await writeFile(join(directory, 'one', 'recipe.json'), '{');
    expect(await errorCode(referencesOnMain(directory))).toBe('INVALID_INPUT');
  });

  test('name the recipes in order whatever order the directory lists them', async () => {
    const directory = await layer1({
      one: recipe(KEY_A),
      two: recipe(KEY_A),
      three: recipe(KEY_A),
    });
    const listed = await fs.readdir(directory, { withFileTypes: true });
    const readdir = spyOn(fs, 'readdir').mockImplementation((async () =>
      listed.toReversed()) as unknown as typeof fs.readdir);
    try {
      expect(Object.fromEntries(await referencesOnMain(directory))).toEqual({
        [KEY_A]: ['main:one', 'main:three', 'main:two'],
      });
    } finally {
      readdir.mockRestore();
    }
  });

  test('add the recipes an open pull request carries at its head', async () => {
    const api = new FakeGitHub();
    api.pulls.set(7, {
      files: [
        { filename: 'src/layer1_wasm/aube/recipe.json', status: 'added' },
        { filename: 'src/layer1_wasm/old/recipe.json', status: 'removed' },
        { filename: 'src/layer1_wasm/_shared/recipe.json', status: 'added' },
        { filename: 'src/layer1_wasm/gone/recipe.json', status: 'modified' },
        { filename: 'docs/recipe.json', status: 'added' },
      ],
      contents: {
        'src/layer1_wasm/aube/recipe.json': recipe(KEY_C),
        'src/layer1_wasm/old/recipe.json': recipe(KEY_D),
        'src/layer1_wasm/_shared/recipe.json': recipe(KEY_D),
        'docs/recipe.json': recipe(KEY_D),
      },
    });
    const references = await referencesInOpenPulls(
      api,
      new Map([[KEY_C, ['main:aube']]]),
    );
    expect(Object.fromEntries(references)).toEqual({
      [KEY_C]: ['main:aube', '#7'],
    });
  });

  test('refuse an open pull request whose recipe cannot be read', async () => {
    const api = new FakeGitHub();
    api.pulls.set(8, {
      files: [{ filename: 'src/layer1_wasm/x/recipe.json', status: 'added' }],
      contents: { 'src/layer1_wasm/x/recipe.json': '{' },
    });
    expect(await errorCode(referencesInOpenPulls(api))).toBe('INVALID_INPUT');
  });
});

describe('pruneReleases', () => {
  async function setup() {
    const api = new FakeGitHub();
    releases(api, [
      [`guest-biome-${KEY_A}`, '2026-01-01T00:00:00Z'],
      [`guest-biome-${KEY_B}`, '2026-01-01T00:00:00Z'],
      [`guest-biome-${KEY_C}`, '2026-10-20T00:00:00Z'],
      [`guest-biome-${KEY_D}`, '2026-01-01T00:00:00Z'],
      ['v0.6.0', '2026-01-01T00:00:00Z'],
    ]);
    await api.createDraft(`guest-biome-${'e'.repeat(64)}`);
    const directory = await layer1({ one: recipe(KEY_A) });
    const history: Record<string, string> = {
      [KEY_B]: '2026-09-01T00:00:00Z',
      [KEY_D]: '2026-10-10T00:00:00Z',
    };
    const asked: string[] = [];
    const lastReferencedAt = async (key: string) => {
      asked.push(key);
      return history[key] ?? null;
    };
    return { api, directory, lastReferencedAt, asked };
  }

  test('delete a Release and its tag once its key has gone unreferenced for the grace period', async () => {
    const { api, directory, lastReferencedAt, asked } = await setup();
    const result = await pruneReleases({
      api,
      layer1Directory: directory,
      lastReferencedAt,
      now: NOW,
      graceDays: 30,
      dryRun: false,
    });
    expect(asked.sort()).toEqual([KEY_B, KEY_C, KEY_D]);
    expect(
      result.decisions.map((decision) => [
        decision.buildKey,
        decision.status,
        decision.deleteAfter,
      ]),
    ).toEqual([
      [KEY_A, 'referenced', null],
      [KEY_B, 'delete', '2026-10-01T00:00:00.000Z'],
      [KEY_C, 'waiting', '2026-11-19T00:00:00.000Z'],
      [KEY_D, 'waiting', '2026-11-09T00:00:00.000Z'],
    ]);
    expect(result.decisions[0]?.referencedBy).toEqual(['main:one']);
    expect(result.deleted).toEqual([`guest-biome-${KEY_B}`]);
    expect(api.writes.slice(-2)).toEqual([
      `delete release guest-biome-${KEY_B}`,
      `delete tag guest-biome-${KEY_B}`,
    ]);
    expect(api.tags.has(`guest-biome-${KEY_B}`)).toBe(false);
    expect(api.releases.map((release) => release.tag)).toContain('v0.6.0');
  });

  test('delete a guest tag left without its Release unless a recipe accepts its key', async () => {
    const { api, directory, lastReferencedAt } = await setup();
    const draft = `guest-biome-${'e'.repeat(64)}`;
    const orphan = `guest-biome-${'f'.repeat(64)}`;
    for (const tag of [
      draft,
      orphan,
      `guest-aube-${KEY_A}`,
      'guest-x',
      'v0.6.0',
    ])
      api.tags.add(tag);
    const dry = await pruneReleases({
      api,
      layer1Directory: directory,
      lastReferencedAt,
      now: NOW,
      graceDays: 30,
      dryRun: true,
    });
    expect(dry.orphanTags).toEqual([orphan]);
    expect(renderPruneSummary(dry)).toContain(
      `- \`${orphan}\`: tag with no Release, **would be deleted**`,
    );
    const result = await pruneReleases({
      api,
      layer1Directory: directory,
      lastReferencedAt,
      now: NOW,
      graceDays: 30,
      dryRun: false,
    });
    expect(result.deleted).toEqual([`guest-biome-${KEY_B}`, orphan]);
    expect(api.tags.has(orphan)).toBe(false);
    expect(api.tags.has(draft)).toBe(true);
    expect(api.tags.has(`guest-aube-${KEY_A}`)).toBe(true);
    expect(
      renderPruneSummary({
        dryRun: false,
        graceDays: 30,
        decisions: [],
        orphanTags: [orphan],
        deleted: [orphan],
      }),
    ).toContain(`- \`${orphan}\`: tag with no Release, **deleted**`);
  });

  test('write nothing in a dry run', async () => {
    const { api, directory, lastReferencedAt } = await setup();
    const before = api.writes.length;
    const result = await pruneReleases({
      api,
      layer1Directory: directory,
      lastReferencedAt,
      now: new Date('2027-01-01T00:00:00Z'),
      graceDays: 30,
      dryRun: true,
    });
    expect(
      result.decisions.filter((decision) => decision.status === 'delete'),
    ).toHaveLength(3);
    expect(result.deleted).toEqual([]);
    expect(api.writes.length).toBe(before);
    expect(renderPruneSummary(result)).toContain('would be deleted');
  });

  test('keep a key an open pull request accepts', async () => {
    const { api, directory, lastReferencedAt } = await setup();
    api.pulls.set(593, {
      files: [
        { filename: 'src/layer1_wasm/aube/recipe.json', status: 'added' },
      ],
      contents: { 'src/layer1_wasm/aube/recipe.json': recipe(KEY_B) },
    });
    const result = await pruneReleases({
      api,
      layer1Directory: directory,
      lastReferencedAt,
      now: NOW,
      graceDays: 30,
      dryRun: false,
    });
    expect(result.deleted).toEqual([]);
    expect(
      result.decisions.find((decision) => decision.buildKey === KEY_B)
        ?.referencedBy,
    ).toEqual(['#593']);
  });

  test('refuse a grace period under one day and a Release with no date', async () => {
    const { api, directory, lastReferencedAt } = await setup();
    const options = {
      api,
      layer1Directory: directory,
      lastReferencedAt,
      now: NOW,
      dryRun: true,
    };
    expect(await errorCode(pruneReleases({ ...options, graceDays: 0 }))).toBe(
      'INVALID_INPUT',
    );
    expect(await errorCode(pruneReleases({ ...options, graceDays: 1.5 }))).toBe(
      'INVALID_INPUT',
    );
    api.publishedAt.delete(3);
    expect(await errorCode(pruneReleases({ ...options, graceDays: 30 }))).toBe(
      'EXTERNAL',
    );
  });

  test('summarise every guest Release', async () => {
    const { api, directory, lastReferencedAt } = await setup();
    const summary = renderPruneSummary(
      await pruneReleases({
        api,
        layer1Directory: directory,
        lastReferencedAt,
        now: NOW,
        graceDays: 30,
        dryRun: false,
      }),
    );
    expect(summary).toContain('30 days after');
    expect(summary).toContain(
      `| \`guest-biome-${KEY_A}\` | referenced by main:one | – | – |`,
    );
    expect(summary).toContain(`| \`guest-biome-${KEY_B}\` | **deleted** |`);
    expect(summary).toContain(`| \`guest-biome-${KEY_C}\` | waiting |`);
    expect(summary).not.toContain('v0.6.0');
    expect(
      renderPruneSummary({
        dryRun: true,
        graceDays: 30,
        decisions: [],
        orphanTags: [],
        deleted: [],
      }),
    ).toContain('dry run, nothing deleted');
  });
});

async function history() {
  const root = await tempDir('fgb-history-');
  await git(root, 'init', '--quiet', '--initial-branch=main');
  const recipePath = join(root, 'src/layer1_wasm/one/recipe.json');
  await mkdir(join(root, 'src/layer1_wasm/one'), { recursive: true });
  const commit = async (text: string, date: string) => {
    await writeFile(recipePath, text);
    await git(root, 'add', '.');
    await runProcess('git', ['commit', '--quiet', '-m', date], {
      cwd: root,
      env: {
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_DATE: date,
        GIT_AUTHOR_DATE: date,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
    });
  };
  await commit(recipe(KEY_A), '2026-08-01T00:00:00Z');
  await commit(recipe(KEY_B), '2026-09-01T00:00:00Z');
  await commit(recipe(KEY_C), '2026-10-01T00:00:00Z');
  return root;
}

describe('historyLookup', () => {
  test('date a key from the main commit that last changed its references', async () => {
    const root = await history();
    const lookup = await historyLookup(runProcess, root);
    expect(Date.parse((await lookup(KEY_A)) ?? '')).toBe(
      Date.parse('2026-09-01T00:00:00Z'),
    );
    expect(Date.parse((await lookup(KEY_B)) ?? '')).toBe(
      Date.parse('2026-10-01T00:00:00Z'),
    );
    expect(await lookup(KEY_D)).toBeNull();
  });

  test('refuse a shallow checkout and a directory outside git', async () => {
    const root = await history();
    const shallow = await tempDir('fgb-shallow-');
    await git(
      shallow,
      'clone',
      '--quiet',
      '--depth',
      '1',
      `file://${root}`,
      '.',
    );
    expect(await errorCode(historyLookup(runProcess, shallow))).toBe(
      'INVALID_INPUT',
    );
    expect(await errorCode(historyLookup(runProcess, await tempDir()))).toBe(
      'EXTERNAL',
    );
  });
});

describe('prune command', () => {
  test('prunes under the history of the checkout and appends the summary', async () => {
    const root = await history();
    const api = new FakeGitHub();
    releases(api, [
      [`guest-biome-${KEY_A}`, '2026-07-01T00:00:00Z'],
      [`guest-biome-${KEY_C}`, '2026-10-01T00:00:00Z'],
    ]);
    const summary = join(await tempDir(), 'summary.md');
    const out: string[] = [];
    const code = await main(
      [
        'prune',
        '--repository-root',
        root,
        '--dry-run',
        'false',
        '--summary',
        summary,
      ],
      {
        stdout: (text) => out.push(text),
        stderr: (text) => out.push(text),
        env: {
          GITHUB_REPOSITORY: 'aletheia-works/vivarium',
          GITHUB_TOKEN: 'secret-token',
        },
      },
      { api: () => api, now: () => NOW },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out.join('')).deleted).toEqual([`guest-biome-${KEY_A}`]);
    expect(await readFile(summary, 'utf8')).toContain('**deleted**');
  });

  test('takes the grace period and refuses a dry run that is not true or false', async () => {
    const root = await history();
    const api = new FakeGitHub();
    releases(api, [[`guest-biome-${KEY_A}`, '2026-07-01T00:00:00Z']]);
    const summary = join(await tempDir(), 'summary.md');
    const run = (dryRun: string) => {
      const err: string[] = [];
      const out: string[] = [];
      return main(
        [
          'prune',
          '--repository-root',
          root,
          '--dry-run',
          dryRun,
          '--grace-days',
          '60',
          '--summary',
          summary,
        ],
        {
          stdout: (text) => out.push(text),
          stderr: (text) => err.push(text),
          env: {
            GITHUB_REPOSITORY: 'aletheia-works/vivarium',
            GITHUB_TOKEN: 'secret-token',
          },
        },
        { api: () => api, now: () => NOW },
      ).then((code) => ({ code, out, err }));
    };
    const kept = await run('true');
    expect(kept.code).toBe(0);
    expect(JSON.parse(kept.out.join('')).decisions[0].status).toBe('waiting');
    const refused = await run('yes');
    expect(refused.code).toBe(1);
    expect(refused.err.join('')).toContain('INVALID_INPUT');
    await rm(root, { recursive: true });
  });
});

describe('createGitHubApi pruning calls', () => {
  function recording(responses: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; method: string }[] = [];
    const api = createGitHubApi({
      repository: 'aletheia-works/vivarium',
      token: 't',
      fetcher: async (url, init = {}) => {
        calls.push({ url, method: init.method ?? 'GET' });
        return responses(url, init);
      },
    });
    return { api, calls };
  }

  test('list Releases, open pull requests and their files across pages', async () => {
    const page = (count: number, make: (index: number) => unknown) =>
      Response.json(Array.from({ length: count }, (_, index) => make(index)));
    const { api } = recording((url) => {
      if (url.includes('/releases?'))
        return url.endsWith('page=1')
          ? page(100, (index) => ({
              id: index,
              tag_name: `t${index}`,
              draft: false,
              published_at: '2026-01-01T00:00:00Z',
            }))
          : page(1, () => ({
              id: 100,
              tag_name: 'd',
              draft: true,
              published_at: null,
            }));
      if (url.includes('/git/matching-refs/tags/guest-'))
        return Response.json([{ ref: `refs/tags/guest-biome-${KEY_A}` }]);
      if (url.includes('/pulls?'))
        return url.endsWith('page=1')
          ? page(100, (index) => ({ number: index }))
          : page(0, () => ({}));
      return page(2, (index) => ({
        filename: `f${index}`,
        status: 'added',
        sha: 'x',
      }));
    });
    const listed = await api.listReleases();
    expect(listed).toHaveLength(101);
    expect(listed[100]).toEqual({
      id: 100,
      tag: 'd',
      draft: true,
      publishedAt: null,
    });
    expect(await api.openPulls()).toHaveLength(100);
    expect(await api.guestTags()).toEqual([`guest-biome-${KEY_A}`]);
    expect(await api.pullFiles(3)).toEqual([
      { filename: 'f0', status: 'added' },
      { filename: 'f1', status: 'added' },
    ]);
  });

  test('delete a published Release and its tag, and read a file at a ref', async () => {
    const { api, calls } = recording((url, init) => {
      if (init.method === 'DELETE')
        return new Response(null, {
          status: url.includes('/missing') ? 422 : 204,
        });
      if (url.includes('/contents/src/layer1_wasm/a/recipe.json'))
        return new Response('{"guests":[]}');
      return new Response(null, { status: 404 });
    });
    await api.deletePublished({
      id: 9,
      tag: 't',
      draft: false,
      publishedAt: null,
    });
    await api.deleteTag('guest-x');
    await api.deleteTag('missing');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'DELETE https://api.github.com/repos/aletheia-works/vivarium/releases/9',
      'DELETE https://api.github.com/repos/aletheia-works/vivarium/git/refs/tags/guest-x',
      'DELETE https://api.github.com/repos/aletheia-works/vivarium/git/refs/tags/missing',
    ]);
    expect(
      await errorCode(
        api.deletePublished({
          id: 1,
          tag: 't',
          draft: true,
          publishedAt: null,
        }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await api.fileAt('src/layer1_wasm/a/recipe.json', 'refs/pull/1/head'),
    ).toBe('{"guests":[]}');
    expect(
      await api.fileAt('src/layer1_wasm/b/recipe.json', 'refs/pull/1/head'),
    ).toBeNull();
  });

  test('fail on unexpected statuses', async () => {
    const { api } = recording(() => new Response(null, { status: 500 }));
    expect(
      await errorCode(
        api.deletePublished({
          id: 1,
          tag: 't',
          draft: false,
          publishedAt: null,
        }),
      ),
    ).toBe('EXTERNAL');
    expect(await errorCode(api.deleteTag('t'))).toBe('EXTERNAL');
    expect(await errorCode(api.fileAt('a', 'b'))).toBe('EXTERNAL');
  });
});
