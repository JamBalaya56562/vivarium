import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { verifyGuestSet } from '../src/artifact.ts';
import { parseAllowlist } from '../src/declaration.ts';
import { BuildError } from '../src/errors.ts';
import type { Fetcher } from '../src/http.ts';
import { type BuildRequest, runBuild } from '../src/pipeline.ts';
import { runProcess } from '../src/process.ts';
import { createUpstream, git, tempDir } from './helpers/git.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const IMAGE = `docker.io/library/rust@${DIGEST}`;
const DOCKER = new URL('./fixtures/fake-docker.sh', import.meta.url).pathname;
const STUCK_GIT = new URL('./fixtures/stuck-git.sh', import.meta.url).pathname;
const BUILDER = new URL('../container', import.meta.url).pathname;
const apk = new TextEncoder().encode('apk');
const apkSha = new Bun.CryptoHasher('sha256').update(apk).digest('hex');
const toolsConfig = {
  schemaVersion: 1,
  images: { '1.98.1': IMAGE },
  mbx: {
    version: '1.24.1',
    url: 'https://example.invalid/mbx.tar.gz',
    sha256: apkSha,
    maxTotalSize: '1GiB',
  },
  cargoAbout: {
    version: '0.9.2',
    url: 'https://example.invalid/cargo-about.tar.gz',
    sha256: apkSha,
  },
  tools: {
    biome: {
      package: 'biome_cli',
      binary: 'biome',
      target: 'x86_64-unknown-linux-musl',
      environment: { CARGO_INCREMENTAL: '0' },
      extraPackages: [
        {
          name: 'make',
          url: 'https://example.invalid/make.apk',
          sha256: apkSha,
          repository: 'https://example.invalid/aports',
          commit: 'c'.repeat(40),
        },
      ],
    },
  },
};
const allowlist = parseAllowlist({
  schemaVersion: 1,
  repositories: ['https://github.com/biomejs/biome'],
});
const files = {
  'Cargo.toml': '[workspace]\n',
  'Cargo.lock':
    'version = 4\n[[package]]\nname = "x"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
  'rust-toolchain.toml': '[toolchain]\nchannel = "1.98.1"\n',
  LICENSE: 'MIT License\n\nCopyright (c) Biome Developers\n',
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

let log: string;
const saved = { ...process.env };
beforeEach(async () => {
  await chmod(DOCKER, 0o755);
  log = join(await tempDir(), 'docker.log');
  Object.assign(process.env, {
    FAKE_DOCKER_LOG: log,
    FAKE_REPO_DIGEST: DIGEST,
    FAKE_RUST: '1.98.1',
    FAKE_TARGET: 'x86_64-unknown-linux-musl',
    FAKE_BINARY: 'biome',
  });
});
afterEach(() => {
  for (const name of Object.keys(process.env))
    if (name.startsWith('FAKE_')) delete process.env[name];
  Object.assign(process.env, saved);
});

function fetcherFor(published?: Record<string, Uint8Array>): Fetcher {
  return async (url) => {
    if (url.endsWith('.apk') || url.endsWith('.tar.gz'))
      return new Response(apk);
    if (url.includes('/releases/tags/')) {
      if (published === undefined) return new Response('{}', { status: 404 });
      return Response.json({
        draft: false,
        assets: Object.keys(published).map((name) => ({ name })),
      });
    }
    const name = url.split('/').pop() as string;
    const bytes = published?.[name];
    return bytes === undefined
      ? new Response('missing', { status: 404 })
      : new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  };
}

async function request(commit: string, mbx = true): Promise<BuildRequest> {
  const root = await tempDir('fgb-pipe-');
  return {
    declaration: {
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      commit,
      fixture: 'biome-12265',
    },
    allowlist,
    toolsConfig,
    workDirectory: join(root, 'work'),
    outputDirectory: join(root, 'out'),
    builderDirectory: BUILDER,
    patchDirectory: join(root, 'patches'),
    mbxCache: mbx ? join(root, 'mbx') : null,
    runUrl: 'https://github.com/aletheia-works/vivarium/actions/runs/1',
    runnerInfo: { bun: 'test' },
  };
}

const deps = (url: string, fetcher: Fetcher) => ({
  run: runProcess,
  docker: DOCKER,
  fetcher,
  cloneUrl: () => url,
  minFreeDiskBytes: 0,
  monitorIntervalMs: 10,
  killGraceMs: 200,
});

describe('runBuild', () => {
  test('compiles when nothing is published and leaves a verified set under the key', async () => {
    const upstream = await createUpstream(files);
    const req = await request(upstream.main);
    const receipt = await runBuild(req, deps(upstream.url, fetcherFor()));
    expect(receipt.compiled).toBe(true);
    expect(receipt.tag).toBe(`guest-biome-${receipt.buildKey}`);
    const directory = receipt.artifactDirectory as string;
    expect((await readdir(directory)).sort()).toEqual([
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'biome',
      'build-info.json',
      'catalog.json',
    ]);
    const read = async (name: string) =>
      new Uint8Array(await readFile(join(directory, name)));
    const set = {
      elf: await read('biome'),
      buildInfo: await read('build-info.json'),
      catalog: await read('catalog.json'),
      license: await read('LICENSE'),
      notices: await read('THIRD_PARTY_NOTICES.md'),
    };
    const verified = verifyGuestSet(set, {
      buildKey: receipt.buildKey,
      tool: 'biome',
      repository: 'https://github.com/biomejs/biome',
      commit: upstream.main,
    });
    expect(verified.elfSha256).toBe(receipt.elfSha256);
    expect(receipt.sizes.sourceBytes).toBeGreaterThan(0);
    expect(receipt.sizes.dependencyBytes).toBe(100);
    const info = JSON.parse(new TextDecoder().decode(set.buildInfo));
    expect(info.reference.builder.environment.RUSTUP_TOOLCHAIN).toBe('1.98.1');
    const calls = await readFile(log, 'utf8');
    expect(calls.match(/RUSTUP_TOOLCHAIN=1\.98\.1/g)?.length).toBe(3);
    expect(new TextDecoder().decode(set.license)).toContain(
      'Copyright (c) Biome Developers',
    );
    expect(new TextDecoder().decode(set.notices)).toContain(
      '- biome_cli 0.0.0',
    );
    expect(info.reference.builder.notices.cargoAbout.version).toBe('0.9.2');
    expect(receipt.durationsMs.notices).toBeGreaterThanOrEqual(0);
    const build =
      calls.split('\n').find((line) => line.includes('/builder/build.sh')) ??
      '';
    expect(build).toContain('CARGO_TARGET_DIR=/work/target');
  });

  test('reuses a published set without fetching dependencies or compiling', async () => {
    const upstream = await createUpstream(files);
    const first = await runBuild(
      await request(upstream.main),
      deps(upstream.url, fetcherFor()),
    );
    const directory = first.artifactDirectory as string;
    const published: Record<string, Uint8Array> = {};
    for (const name of await readdir(directory))
      published[name] = new Uint8Array(await readFile(join(directory, name)));
    await Bun.write(log, '');
    const second = await runBuild(
      await request(upstream.main),
      deps(upstream.url, fetcherFor(published)),
    );
    expect(second.compiled).toBe(false);
    expect(second.buildKey).toBe(first.buildKey);
    expect(second.elfSha256).toBe(first.elfSha256);
    const calls = await readFile(log, 'utf8');
    expect(calls).not.toContain('cargo fetch');
    expect(calls).not.toContain('/builder/build.sh');
    expect(calls).not.toContain('/builder/notices.sh');
  });

  test('gives a different key when mbx is off, and the same key for the same inputs', async () => {
    const upstream = await createUpstream(files);
    const a = await runBuild(
      await request(upstream.main),
      deps(upstream.url, fetcherFor()),
    );
    const b = await runBuild(
      await request(upstream.main),
      deps(upstream.url, fetcherFor()),
    );
    const c = await runBuild(
      await request(upstream.main, false),
      deps(upstream.url, fetcherFor()),
    );
    expect(b.buildKey).toBe(a.buildKey);
    expect(c.buildKey).not.toBe(a.buildKey);
  });

  test('refuses an image whose Rust differs from rust-toolchain and removes the work directory', async () => {
    const upstream = await createUpstream(files);
    process.env.FAKE_RUST = '1.99.0';
    const req = await request(upstream.main);
    expect(
      await errorCode(runBuild(req, deps(upstream.url, fetcherFor()))),
    ).toBe('VERIFY_FAILED');
    expect(await stat(req.workDirectory).catch(() => null)).toBeNull();
  });

  test('stops a source above the size limit before building', async () => {
    const upstream = await createUpstream(files);
    const req = await request(upstream.main);
    expect(
      await errorCode(
        runBuild(req, {
          ...deps(upstream.url, fetcherFor()),
          sourceLimitBytes: 10,
        }),
      ),
    ).toBe('LIMIT_EXCEEDED');
    expect(await readFile(log, 'utf8').catch(() => '')).not.toContain(
      '/builder/build.sh',
    );
  });

  test('stops a clone that ignores SIGTERM above the size limit within the kill grace', async () => {
    const upstream = await createUpstream(files);
    const req = await request(upstream.main);
    const bin = await tempDir('fgb-git-');
    await cp(STUCK_GIT, join(bin, 'git'));
    await chmod(join(bin, 'git'), 0o755);
    process.env.FAKE_REAL_GIT = Bun.which('git') ?? 'git';
    process.env.PATH = `${bin}:${process.env.PATH}`;
    expect(
      await errorCode(
        runBuild(req, {
          ...deps(upstream.url, fetcherFor()),
          sourceLimitBytes: 10,
        }),
      ),
    ).toBe('LIMIT_EXCEEDED');
    expect(await readFile(log, 'utf8').catch(() => '')).not.toContain(
      '/builder/build.sh',
    );
  });

  test('reports TIMEOUT at the deadline, stops the build and leaves no staging', async () => {
    const upstream = await createUpstream(files);
    process.env.FAKE_BUILD_SLEEP = '20';
    const req = await request(upstream.main);
    const started = Date.now();
    expect(
      await errorCode(
        runBuild(req, {
          ...deps(upstream.url, fetcherFor()),
          deadlineMs: 4000,
        }),
      ),
    ).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await stat(req.workDirectory).catch(() => null)).toBeNull();
    expect(
      (await readdir(req.outputDirectory).catch(() => [])).filter((name) =>
        name.startsWith('.staging'),
      ),
    ).toEqual([]);
  });

  test('refuses a tool with no build configuration and a source without Cargo.lock', async () => {
    const upstream = await createUpstream(files);
    const req = await request(upstream.main);
    expect(
      await errorCode(
        runBuild(
          {
            ...req,
            declaration: { ...(req.declaration as object), tool: 'aube' },
          },
          deps(upstream.url, fetcherFor()),
        ),
      ),
    ).toBe('INVALID_INPUT');
    const noLock = await createUpstream({
      'Cargo.toml': '[workspace]\n',
      'rust-toolchain.toml': files['rust-toolchain.toml'],
    });
    expect(
      await errorCode(
        runBuild(await request(noLock.main), deps(noLock.url, fetcherFor())),
      ),
    ).toBe('INVALID_INPUT');
  });
});

test('the pipeline uses the shipped container script', async () => {
  const copy = join(await tempDir(), 'build.sh');
  await cp(join(BUILDER, 'build.sh'), copy);
  expect(await readFile(copy, 'utf8')).toContain('--no-network');
});

describe('runBuild edges', () => {
  test('builds with a missing mbx cache and a builder copy that has no sources beside it', async () => {
    const upstream = await createUpstream(files);
    const req = await request(upstream.main);
    const builder = join(await tempDir(), 'container');
    await cp(BUILDER, builder, { recursive: true });
    const receipt = await runBuild(
      {
        ...req,
        builderDirectory: builder,
        mbxCache: join(await tempDir(), 'absent'),
      },
      deps(upstream.url, fetcherFor()),
    );
    expect(receipt.compiled).toBe(true);
  });

  test('refuses a source whose Rust has no pinned image', async () => {
    const upstream = await createUpstream({
      ...files,
      'rust-toolchain.toml': '[toolchain]\nchannel = "1.50.0"\n',
    });
    expect(
      await errorCode(
        runBuild(
          await request(upstream.main),
          deps(upstream.url, fetcherFor()),
        ),
      ),
    ).toBe('INVALID_INPUT');
  });
});

describe('mbx cache record', () => {
  async function built(prefill: boolean) {
    const upstream = await createUpstream(files);
    const req = await request(upstream.main);
    await mkdir(req.mbxCache as string, { recursive: true });
    if (prefill)
      await writeFile(join(req.mbxCache as string, 'restored-entry'), 'x');
    process.env.FAKE_MBX_WRITE = '1';
    const receipt = await runBuild(
      {
        ...req,
        mbxCacheKeys: {
          requested: 'mbx-key',
          matched: prefill ? 'mbx-key' : null,
        },
      },
      deps(upstream.url, fetcherFor()),
    );
    const info = JSON.parse(
      await readFile(
        join(receipt.artifactDirectory as string, 'build-info.json'),
        'utf8',
      ),
    );
    return info.reference;
  }

  test('counts an empty cache as not restored even though the build writes into it', async () => {
    const reference = await built(false);
    expect(reference.mbxCacheRestored).toBe(false);
    expect(reference.mbxCacheKeys).toEqual({
      requested: 'mbx-key',
      matched: null,
    });
  });

  test('counts a cache restored before the build as restored and records the matched key', async () => {
    const reference = await built(true);
    expect(reference.mbxCacheRestored).toBe(true);
    expect(reference.mbxCacheKeys).toEqual({
      requested: 'mbx-key',
      matched: 'mbx-key',
    });
  });
});

describe('git dependencies and a broken cache', () => {
  const withGitDependency = (commit: string) => ({
    ...files,
    'Cargo.lock': `version = 4\n[[package]]\nname = "x"\nversion = "1.0.0"\nsource = "git+https://github.com/biomejs/biome?rev=${commit}#${commit}"\n`,
  });

  test('builds when the git dependency commit is reachable from its repository', async () => {
    const upstream = await createUpstream(files);
    const work = join(await tempDir(), 'work');
    await git(
      await tempDir(),
      'clone',
      '--quiet',
      '--branch',
      'main',
      upstream.url,
      work,
    );
    await writeFile(
      join(work, 'Cargo.lock'),
      withGitDependency(upstream.tagged)['Cargo.lock'],
    );
    await git(work, 'add', 'Cargo.lock');
    await git(
      work,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@e.invalid',
      'commit',
      '--quiet',
      '-m',
      'lock',
    );
    await git(work, 'push', '--quiet', 'origin', 'HEAD:main');
    const head = await git(work, 'rev-parse', 'HEAD');
    const receipt = await runBuild(
      await request(head),
      deps(upstream.url, fetcherFor()),
    );
    expect(receipt.compiled).toBe(true);
    expect(receipt.durationsMs['dependency-sources']).toBeGreaterThanOrEqual(0);
  });

  test('refuses a git dependency commit its repository does not reach, before fetching', async () => {
    const elsewhere = (await createUpstream()).dangling;
    const declared = await createUpstream(withGitDependency(elsewhere));
    await Bun.write(log, '');
    expect(
      await errorCode(
        runBuild(
          await request(declared.main),
          deps(declared.url, fetcherFor()),
        ),
      ),
    ).toBe('SOURCE_UNREACHABLE');
    expect(await readFile(log, 'utf8')).not.toContain('cargo fetch');
  });

  test('a cache that breaks the build fails it without leaving an artifact', async () => {
    const upstream = await createUpstream(files);
    const req = await request(upstream.main);
    await mkdir(req.mbxCache as string, { recursive: true });
    await writeFile(
      join(req.mbxCache as string, 'garbage'),
      'not a cache object',
    );
    process.env.FAKE_BUILD_CODE = '101';
    expect(
      await errorCode(runBuild(req, deps(upstream.url, fetcherFor()))),
    ).toBe('EXTERNAL');
    expect(await readdir(req.outputDirectory).catch(() => [])).toEqual([]);
    expect(await stat(req.workDirectory).catch(() => null)).toBeNull();
  });
});
