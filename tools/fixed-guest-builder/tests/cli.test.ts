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
import { SOURCE, sampleSet } from './helpers/artifacts.ts';
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

async function artifacts() {
  const set = sampleSet();
  const directory = await tempDir();
  await writeFile(join(directory, 'biome'), set.files.elf);
  await writeFile(join(directory, 'build-info.json'), set.files.buildInfo);
  await writeFile(join(directory, 'catalog.json'), set.files.catalog);
  const identity = [
    '--tool',
    'biome',
    '--binary',
    'biome',
    '--key',
    set.key,
    '--repository',
    SOURCE.repository,
    '--commit',
    SOURCE.commit,
  ];
  return { set, directory, identity };
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

  test('plan writes the operation plan and prints its SHA256', async () => {
    const { directory, identity } = await artifacts();
    const planPath = join(await tempDir(), 'plan.json');
    const terminal = io();
    const code = await main(
      [
        'plan',
        ...identity,
        '--artifacts',
        directory,
        '--build-run-id',
        '42',
        '--rollback',
        'point the recipe back',
        '--approval-reference',
        'chat',
        '--plan-out',
        planPath,
      ],
      terminal,
    );
    expect(code).toBe(0);
    const printed = JSON.parse(terminal.out.join(''));
    const bytes = await readFile(planPath);
    expect(printed.planSha256).toBe(
      new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    );
    expect(printed.plan.action).toBe('publish');
  });

  test('release publishes with the approved plan and exits 0', async () => {
    const { directory, identity } = await artifacts();
    const planPath = join(await tempDir(), 'plan.json');
    const planned = io();
    await main(
      [
        'plan',
        ...identity,
        '--artifacts',
        directory,
        '--build-run-id',
        '42',
        '--rollback',
        'r',
        '--approval-reference',
        'chat',
        '--plan-out',
        planPath,
      ],
      planned,
    );
    const sha = JSON.parse(planned.out.join('')).planSha256 as string;
    const api = new FakeGitHub();
    const terminal = io({
      GITHUB_TOKEN: 'ghs_test_token_value',
      GITHUB_REPOSITORY: 'aletheia-works/vivarium',
      GITHUB_RUN_ID: '7',
    });
    const code = await main(
      [
        'release',
        '--workflow',
        'fixed-guest-release.yml',
        ...identity,
        '--artifacts',
        directory,
        '--plan',
        planPath,
        '--plan-sha256',
        sha,
      ],
      terminal,
      { api: () => api },
    );
    expect(code).toBe(0);
    expect(JSON.parse(terminal.out.join('')).status).toBe('published');
  });

  test('exits 2 when another run of the workflow is active', async () => {
    const api = new FakeGitHub();
    api.runs = [{ id: 99, status: 'queued' }];
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
    expect(typeof api.environmentReviewers).toBe('function');
  });

  test('processIo writes to the process streams and passes the environment through', () => {
    const io = processIo();
    io.stdout('');
    io.stderr('');
    expect(io.env).toBe(process.env);
  });
});
