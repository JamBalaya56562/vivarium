import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CliIo,
  defaultApi,
  main,
  parseFlags,
  processIo,
} from '../src/cli.ts';
import { BuildError } from '../src/errors.ts';
import { runProcess } from '../src/process.ts';
import { assetsOf, SOURCE, sampleSet } from './helpers/artifacts.ts';
import { FakeGitHub } from './helpers/fake-github.ts';
import { createUpstream, tempDir } from './helpers/git.ts';

function io(
  env: Record<string, string> = {},
): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env,
  };
}

const BUILD_RUN = 42;

async function artifacts() {
  const runUrl = `https://github.com/aletheia-works/vivarium/actions/runs/${BUILD_RUN}`;
  const set = sampleSet('\x7fELF-sample', { reference: { ciRunUrl: runUrl } });
  const directory = await tempDir();
  const sha = (bytes: Uint8Array) =>
    new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  await writeFile(
    join(directory, 'receipt.json'),
    JSON.stringify({
      schemaVersion: 1,
      buildKey: set.key,
      tag: `guest-biome-${set.key}`,
      compiled: true,
      elfSha256: sha(set.files.elf),
      buildInfoSha256: sha(set.files.buildInfo),
      catalogSha256: sha(set.files.catalog),
      source: SOURCE,
      ciRunUrl: runUrl,
    }),
  );
  await mkdir(join(directory, set.key));
  for (const [name, bytes] of Object.entries(assetsOf(set.files)))
    await writeFile(join(directory, set.key, name), bytes);
  const api = new FakeGitHub();
  api.addBuildRun(BUILD_RUN);
  return { set, directory, api };
}

const GITHUB_ENV = {
  GITHUB_TOKEN: 'ghs_test_token_value',
  GITHUB_REPOSITORY: 'aletheia-works/vivarium',
  GITHUB_RUN_ID: '7',
};

async function prepare(directory: string, api: FakeGitHub) {
  const out = await tempDir();
  const paths = {
    plan: join(out, 'plan.json'),
    summary: join(out, 'summary.md'),
  };
  const terminal = io(GITHUB_ENV);
  const code = await main(
    [
      'prepare',
      '--build-run-id',
      String(BUILD_RUN),
      '--artifacts',
      directory,
      '--plan-out',
      paths.plan,
      '--summary',
      paths.summary,
    ],
    terminal,
    { api: () => api },
  );
  return { code, terminal, paths };
}

describe('parseFlags', () => {
  test('reads --name value pairs and refuses stray, missing or repeated values', () => {
    expect(parseFlags(['--a', '1', '--b', '2'])).toEqual({ a: '1', b: '2' });
    expect(() => parseFlags(['oops'])).toThrow(BuildError);
    expect(() => parseFlags(['--a'])).toThrow(BuildError);
    expect(() => parseFlags(['--a', '--b'])).toThrow(BuildError);
    expect(() => parseFlags(['--a', '1', '--a', '2'])).toThrow(BuildError);
  });
});

describe('main', () => {
  test('prints a stable error code for an unknown command and exits 1', async () => {
    const terminal = io();
    expect(await main(['deploy'], terminal)).toBe(1);
    expect(JSON.parse(terminal.err.join('')).error.code).toBe('INVALID_INPUT');
  });

  test('never prints the token, even when an error message would contain it', async () => {
    const terminal = io({
      GITHUB_TOKEN: 'ghs_secret',
      GITHUB_REPOSITORY: 'aletheia-works/vivarium',
      GITHUB_RUN_ID: '5',
    });
    const code = await main(
      ['release', '--workflow', 'x.yml', '--tool', 'biome'],
      terminal,
      {
        api: () => {
          throw new BuildError('EXTERNAL', 'request with ghs_secret failed');
        },
      },
    );
    expect(code).toBe(1);
    expect(terminal.err.join('')).not.toContain('ghs_secret');
    expect(terminal.err.join('')).toContain('***');
  });

  test('prepare writes the plan and the summary and prints the plan SHA256', async () => {
    const { set, directory, api } = await artifacts();
    const { code, terminal, paths } = await prepare(directory, api);
    expect(code).toBe(0);
    const printed = JSON.parse(terminal.out.join(''));
    const bytes = await readFile(paths.plan);
    expect(printed.planSha256).toBe(
      new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    );
    expect(printed.plan.action).toBe('publish');
    expect(printed.identity).toMatchObject({ tool: 'biome', key: set.key });
    expect(await readFile(paths.summary, 'utf8')).toContain(printed.planSha256);
    expect(api.writes).toEqual([]);
  });

  async function release(
    directory: string,
    api: FakeGitHub,
    plan: string,
    sha: string,
  ) {
    const terminal = io(GITHUB_ENV);
    const code = await main(
      [
        'release',
        '--workflow',
        'fixed-guest-release.yml',
        '--build-run-id',
        String(BUILD_RUN),
        '--artifacts',
        directory,
        '--plan',
        plan,
        '--plan-sha256',
        sha,
      ],
      terminal,
      { api: () => api },
    );
    return { code, terminal };
  }

  test('release publishes under the prepared plan and exits 0', async () => {
    const { directory, api } = await artifacts();
    const prepared = await prepare(directory, api);
    const sha = JSON.parse(prepared.terminal.out.join('')).planSha256 as string;
    const { code, terminal } = await release(
      directory,
      api,
      prepared.paths.plan,
      sha,
    );
    expect(code).toBe(0);
    expect(JSON.parse(terminal.out.join('')).status).toBe('published');
  });

  test('accept writes the published build into the recipes that declare its source', async () => {
    const { set, directory, api } = await artifacts();
    const prepared = await prepare(directory, api);
    const sha = JSON.parse(prepared.terminal.out.join('')).planSha256 as string;
    const released = await release(directory, api, prepared.paths.plan, sha);
    const published = join(directory, 'published.json');
    await writeFile(published, released.terminal.out.join(''));
    const layer1 = join(directory, 'layer1');
    await mkdir(join(layer1, 'recipe'), { recursive: true });
    const recipe = join(layer1, 'recipe', 'recipe.json');
    await writeFile(
      recipe,
      JSON.stringify({
        guests: [{ role: 'fix', tool: 'biome', ...SOURCE, fixture: 'f' }],
      }),
    );
    const terminal = io();
    expect(
      await main(
        ['accept', '--published', published, '--layer1', layer1],
        terminal,
      ),
    ).toBe(0);
    expect(JSON.parse(terminal.out.join(''))).toMatchObject({
      changed: true,
      changes: [{ recipe: 'recipe', role: 'fix', previousBuildKey: null }],
    });
    const accepted = JSON.parse(await readFile(recipe, 'utf8')).guests[0]
      .accepted;
    expect(accepted).toMatchObject({
      commit: SOURCE.commit,
      buildKey: set.key,
    });
  });

  test('release writes nothing when the plan SHA256 is not the prepared one', async () => {
    const { directory, api } = await artifacts();
    const prepared = await prepare(directory, api);
    const { code, terminal } = await release(
      directory,
      api,
      prepared.paths.plan,
      'e'.repeat(64),
    );
    expect(code).toBe(1);
    expect(JSON.parse(terminal.err.join('')).error.code).toBe('VERIFY_FAILED');
    expect(api.writes).toEqual([]);
  });

  test('exits 2 when another run of the workflow is active', async () => {
    const api = new FakeGitHub();
    api.runs = [{ id: 99, status: 'in_progress' }];
    const terminal = io({
      GITHUB_TOKEN: 'ghs_test_token_value',
      GITHUB_REPOSITORY: 'aletheia-works/vivarium',
      GITHUB_RUN_ID: '7',
    });
    const work = join(await tempDir(), 'w');
    await mkdir(work);
    expect(
      await main(
        [
          'bump',
          '--workflow',
          'fixed-guest-bump.yml',
          '--recipe',
          'r.json',
          '--role',
          'baseline',
          '--work',
          work,
        ],
        terminal,
        { api: () => api },
      ),
    ).toBe(2);
    expect(JSON.parse(terminal.err.join('')).error.code).toBe('BUSY');
  });

  test('publish-turn prints the wait, and exits 2 while another publish stays ahead', async () => {
    const timing = {
      waitMs: 0,
      firstDelayMs: 1,
      maxDelayMs: 1,
      settleMs: 0,
      now: () => 0,
      sleep: async () => undefined,
    };
    const api = new FakeGitHub();
    const free = io(GITHUB_ENV);
    expect(
      await main(['publish-turn'], free, {
        api: () => api,
        turnTiming: timing,
      }),
    ).toBe(0);
    expect(JSON.parse(free.out.join(''))).toEqual({ waitedMs: 0 });
    api.runs = [{ id: 3, status: 'in_progress' }];
    api.jobs.set(3, [
      {
        name: 'publish 0123',
        status: 'in_progress',
        conclusion: null,
        steps: [
          {
            name: 'Wait for the publish turn',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      },
    ]);
    const busy = io(GITHUB_ENV);
    expect(
      await main(['publish-turn'], busy, {
        api: () => api,
        turnTiming: timing,
      }),
    ).toBe(2);
    expect(JSON.parse(busy.err.join('')).error.code).toBe('BUSY');
  });

  test('requires the GitHub environment for commands that talk to GitHub', async () => {
    const terminal = io();
    expect(await main(['release', '--workflow', 'x.yml'], terminal)).toBe(1);
    expect(JSON.parse(terminal.err.join('')).error.message).toContain(
      'GITHUB_REPOSITORY',
    );
  });
});

describe('build', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const name of Object.keys(process.env))
      if (name.startsWith('FAKE_')) delete process.env[name];
    Object.assign(process.env, saved);
  });

  test('runs the pipeline with the shipped config and writes the receipt', async () => {
    const shipped = await Bun.file(
      new URL('../tools.json', import.meta.url),
    ).json();
    const image = shipped.images['1.98.1'] as string;
    const docker = new URL('./fixtures/fake-docker.sh', import.meta.url)
      .pathname;
    await chmod(docker, 0o755);
    const root = await tempDir();
    Object.assign(process.env, {
      FAKE_DOCKER_LOG: join(root, 'docker.log'),
      FAKE_REPO_DIGEST: image.split('@')[1] as string,
      FAKE_RUST: '1.98.1',
      FAKE_TARGET: 'x86_64-unknown-linux-musl',
      FAKE_BINARY: 'biome',
    });
    const upstream = await createUpstream({
      'Cargo.toml': '[workspace]\n',
      'Cargo.lock': 'version = 4\n[[package]]\nname = "x"\nversion = "1.0.0"\n',
      'rust-toolchain.toml': '[toolchain]\nchannel = "1.98.1"\n',
    });
    const declaration = join(root, 'declaration.json');
    await writeFile(
      declaration,
      JSON.stringify({
        tool: 'biome',
        repository: 'https://github.com/biomejs/biome',
        commit: upstream.main,
        fixture: 'biome-12265',
      }),
    );
    const receipt = join(root, 'receipt.json');
    const terminal = io({
      GITHUB_TOKEN: 'ghs_test_token_value',
      GITHUB_REPOSITORY: 'aletheia-works/vivarium',
      GITHUB_RUN_ID: '11',
    });
    const code = await main(
      [
        'build',
        '--workflow',
        'fixed-guest-build.yml',
        '--declaration',
        declaration,
        '--work',
        join(root, 'work'),
        '--out',
        join(root, 'out'),
        '--mbx-cache',
        'none',
        '--docker',
        docker,
        '--receipt',
        receipt,
      ],
      terminal,
      {
        api: () => new FakeGitHub(),
        build: {
          run: runProcess,
          cloneUrl: () => upstream.url,
          minFreeDiskBytes: 0,
          monitorIntervalMs: 10,
          fetcher: async (url) =>
            url.includes('/releases/tags/')
              ? new Response('{}', { status: 404 })
              : new Response('unused', { status: 404 }),
        },
      },
    );
    // The shipped config pins make, which the fake fetcher does not serve.
    expect(code).toBe(1);
    expect(JSON.parse(terminal.err.join('')).error.code).toBe('EXTERNAL');
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain(
      'pull --quiet',
    );
  });
});

describe('process wiring', () => {
  test('defaultApi builds a GitHub client without contacting GitHub', () => {
    const api = defaultApi('aletheia-works/vivarium', 'ghs_test_token_value');
    expect(typeof api.findRelease).toBe('function');
    expect(typeof api.workflowRun).toBe('function');
  });

  test('processIo writes to the process streams and passes the environment through', () => {
    const io = processIo();
    io.stdout('');
    io.stderr('');
    expect(io.env).toBe(process.env);
  });
});
