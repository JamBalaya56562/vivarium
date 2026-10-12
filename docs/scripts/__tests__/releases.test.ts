import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { configSchema, type GitHub, Manifest } from 'release-please';
import { parseConventionalCommits } from 'release-please/build/src/commit';
import { buildStrategy } from 'release-please/build/src/factory';
import { TagName } from 'release-please/build/src/util/tag-name';
import { Version } from 'release-please/build/src/version';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const config = JSON.parse(read('.github/release-please-config.json'));
const baseline = config['bootstrap-sha'];
const merge = 'b'.repeat(40);
const manifestPath = '.github/release-please-manifest.json';
const versions = { '.': '0.2.2' };
const manifests: string[] = [
  'package.json',
  ...config.packages['.']['extra-files'].map(
    (file: { path: string }) => file.path,
  ),
];
const commits = [
  {
    message: 'fix(mcp): correct a response',
    sha: 'a'.repeat(40),
    files: ['packages/mcp-server/src/server.ts'],
  },
  { message: 'chore: historical release', sha: baseline, files: [] },
];

function client() {
  return {
    repository: { owner: 'aletheia-works', repo: 'vivarium' },
    getFileJson: async (path: string) =>
      path === manifestPath ? versions : JSON.parse(read(path)),
    getFileContentsOnBranch: async (path: string) => ({
      parsedContent: read(path),
    }),
    findFilesByGlobAndRef: async (path: string) => [path],
    releaseIterator: async function* () {
      yield { tagName: 'v0.2.2', sha: baseline, notes: '' };
    },
    mergeCommitIterator: async function* () {
      yield* commits;
    },
  };
}

const load = (github: GitHub) =>
  Manifest.fromManifest(
    github,
    'main',
    '.github/release-please-config.json',
    manifestPath,
  );

describe('shared release version', () => {
  test('configuration conforms to the action engine schema', () => {
    const validate = new Ajv({
      strict: false,
      validateFormats: false,
    }).compile(configSchema);
    expect(
      validate(JSON.parse(read('.github/release-please-config.json'))),
    ).toBe(true);
    expect(validate.errors).toBeNull();
  });

  for (const [message, expected] of [
    ['fix(mcp): correct a response', '0.2.3'],
    ['fix(docs): correct a page', '0.2.3'],
    ['fix(wasm): correct a recipe', '0.2.3'],
    ['feat(mcp): add a tool', '0.3.0'],
    ['feat(mcp)!: change the protocol', '0.3.0'],
    ['docs(mcp): document a tool', undefined],
  ] as const) {
    test(message, async () => {
      const github = client() as unknown as GitHub;
      const manifest = await load(github);
      const strategy = await buildStrategy({
        ...manifest.repositoryConfig['.'],
        github,
        path: '.',
        targetBranch: 'main',
      });
      const pr = await strategy.buildReleasePullRequest(
        parseConventionalCommits([
          {
            ...commits[0],
            message,
            files: [
              message.startsWith('fix(docs)')
                ? 'docs/site/en/index.mdx'
                : message.startsWith('fix(wasm)')
                  ? 'src/layer1_wasm/pandas-56679/recipe.json'
                  : commits[0].files[0],
            ],
          },
        ]),
        {
          tag: new TagName(Version.parse('0.2.2')),
          sha: baseline,
          notes: '',
        },
      );
      expect(pr?.version?.toString()).toBe(expected);
      if (!pr) return;
      for (const path of manifests) {
        const update = pr.updates.find((entry) => entry.path === path);
        expect(update).toBeDefined();
        expect(
          JSON.parse(update!.updater.updateContent(read(path))).version,
        ).toBe(expected);
      }
    });
  }

  test('one release PR creates one tag on its merge commit', async () => {
    const mock = client();
    const github = mock as unknown as GitHub;
    const manifest = await load(github);
    const prs = await manifest.buildPullRequests();
    expect(prs).toHaveLength(1);
    const pr = prs[0];
    let content = JSON.stringify(versions);
    for (const update of pr.updates) {
      if (update.path === manifestPath) {
        content = update.updater.updateContent(content);
      }
    }
    expect(JSON.parse(content)).toEqual({ '.': '0.2.3' });
    Object.assign(mock, {
      pullRequestIterator: async function* () {
        yield {
          number: 1,
          title: pr.title.toString(),
          body: pr.body.toString(),
          headBranchName: pr.headRefName,
          baseBranchName: 'main',
          labels: ['autorelease: pending'],
          files: [],
          sha: merge,
        };
      },
    });
    const releases = await manifest.buildReleases();
    expect(releases).toHaveLength(1);
    expect(releases[0].tag.toString()).toBe('v0.2.3');
    expect(releases[0].sha).toBe(merge);
  });

  test('all first-party manifests are registered and share the root version', () => {
    const discovered = [
      ...new Bun.Glob('**/{package,jsr}.json').scanSync({
        cwd: root.pathname,
        onlyFiles: true,
      }),
    ].filter(
      (path) =>
        !path
          .split('/')
          .some((part) => ['node_modules', 'doc_build', 'dist'].includes(part)),
    );
    expect([...manifests].sort()).toEqual(discovered.sort());
    const version = JSON.parse(read('package.json')).version;
    for (const path of manifests)
      expect(JSON.parse(read(path)).version).toBe(version);
    expect(JSON.parse(read(manifestPath))).toEqual({ '.': version });
  });

  test('already released commits do not create another release PR', async () => {
    const mock = client();
    mock.mergeCommitIterator = async function* () {
      yield commits[1];
    };
    const manifest = await load(mock as unknown as GitHub);
    expect(await manifest.buildPullRequests()).toEqual([]);
  });

  test('migration starts from the shared baseline and excludes older history', async () => {
    const mock = client();
    Object.assign(mock, {
      releaseIterator: async function* () {
        yield { tagName: 'v0.1.3', sha: 'c'.repeat(40), notes: '' };
      },
      tagIterator: async function* () {
        yield { name: 'v0.1.3', sha: 'c'.repeat(40) };
        yield { name: 'mcp-server-v0.2.1', sha: 'c'.repeat(40) };
      },
      mergeCommitIterator: async function* () {
        yield* commits;
        yield { ...commits[0], message: 'feat: historical feature' };
      },
    });
    const manifest = await load(mock as unknown as GitHub);
    const prs = await manifest.buildPullRequests();
    expect(prs).toHaveLength(1);
    expect(prs[0].version?.toString()).toBe('0.2.3');
  });
});
