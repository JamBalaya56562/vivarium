import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ContainerPaths,
  checkDiskFree,
  checkElf,
  checkToolchain,
  compile,
  fetchDependencies,
  finalizeArtifacts,
  generateNotices,
  inspectImage,
  outputTail,
  parseToolsConfig,
  prepareExtras,
  readToolchainChannel,
  removeTree,
  type ToolConfig,
} from '../src/build.ts';
import { BuildError } from '../src/errors.ts';
import { runProcess } from '../src/process.ts';
import { tempDir } from './helpers/git.ts';

const ENV = { CARGO_INCREMENTAL: '0', RUSTUP_TOOLCHAIN: '1.98.1' };
const LICENSE_BYTES = new TextEncoder().encode('MIT License\n');
const NOTICES_BYTES = new TextEncoder().encode('# Third-party notices\n');
const DIGEST = `sha256:${'a'.repeat(64)}`;
const IMAGE = `docker.io/library/rust@${DIGEST}`;
const DOCKER = new URL('./fixtures/fake-docker.sh', import.meta.url).pathname;
const tool: ToolConfig = {
  package: 'biome_cli',
  binary: 'biome',
  target: 'x86_64-unknown-linux-musl',
  environment: { CARGO_INCREMENTAL: '0' },
  extraPackages: [],
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
    FAKE_TARGET: tool.target,
    FAKE_BINARY: tool.binary,
  });
});

afterEach(() => {
  for (const name of Object.keys(process.env))
    if (name.startsWith('FAKE_')) delete process.env[name];
  Object.assign(process.env, saved);
});

async function paths(): Promise<ContainerPaths> {
  const root = await tempDir('fgb-build-');
  const result = {
    source: join(root, 'src'),
    cargoHome: join(root, 'cargo'),
    builderDir: join(root, 'builder'),
    dependencyDir: join(root, 'dependency'),
    mbxCache: join(root, 'mbx'),
  };
  for (const path of Object.values(result))
    await mkdir(path, { recursive: true });
  return result;
}

describe('toolchain', () => {
  test('reads the channel from rust-toolchain.toml or the plain file and refuses neither', async () => {
    const toml = await tempDir();
    await writeFile(
      join(toml, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "1.98.1"\n',
    );
    expect(await readToolchainChannel(toml)).toBe('1.98.1');
    const plain = await tempDir();
    await writeFile(join(plain, 'rust-toolchain'), '1.97.0\n');
    expect(await readToolchainChannel(plain)).toBe('1.97.0');
    expect(await errorCode(readToolchainChannel(await tempDir()))).toBe(
      'INVALID_INPUT',
    );
  });

  test('checkToolchain refuses an image whose Rust differs from the upstream pin', () => {
    expect(() =>
      checkToolchain('rustc 1.98.1\nrelease: 1.98.1\n', '1.98.1'),
    ).not.toThrow();
    expect(() =>
      checkToolchain('rustc 1.99.0\nrelease: 1.99.0\n', '1.98.1'),
    ).toThrow(BuildError);
  });
});

describe('inspectImage', () => {
  test('records the toolchain when the pulled digest matches', async () => {
    const result = await inspectImage(runProcess, DOCKER, IMAGE);
    expect(result.rustc).toBe('rustc 1.98.1 (x 2026-09-01)');
    expect(result.cargo).toBe('cargo 1.98.1 (y 2026-08-05)');
    checkToolchain(result.rustcVerbose, '1.98.1');
    expect(await readFile(log, 'utf8')).toContain('--network none');
  });

  test('refuses a pulled digest that differs, a failed pull and an unpinned image', async () => {
    process.env.FAKE_REPO_DIGEST = `sha256:${'b'.repeat(64)}`;
    expect(await errorCode(inspectImage(runProcess, DOCKER, IMAGE))).toBe(
      'VERIFY_FAILED',
    );
    process.env.FAKE_PULL_CODE = '1';
    expect(await errorCode(inspectImage(runProcess, DOCKER, IMAGE))).toBe(
      'EXTERNAL',
    );
    expect(
      await errorCode(inspectImage(runProcess, DOCKER, 'rust:1.98.1')),
    ).toBe('INVALID_INPUT');
  });
});

describe('checkDiskFree', () => {
  test('accepts exactly the minimum and refuses one byte less', async () => {
    expect(
      await checkDiskFree('/', 4096, async () => ({ bavail: 1, bsize: 4096 })),
    ).toBe(4096);
    expect(
      await errorCode(
        checkDiskFree('/', 4097, async () => ({ bavail: 1, bsize: 4096 })),
      ),
    ).toBe('LIMIT_EXCEEDED');
  });
});

describe('fetchDependencies and compile', () => {
  test('fetches under the size limit, builds offline, and always removes the containers', async () => {
    const p = await paths();
    process.env.FAKE_FETCH_BYTES = '100';
    expect(
      await fetchDependencies({
        run: runProcess,
        docker: DOCKER,
        image: IMAGE,
        paths: p,
        environment: ENV,
        owner: '1001:118',
        limitBytes: 100,
        intervalMs: 10,
      }),
    ).toBe(100);
    const elf = await compile({
      run: runProcess,
      docker: DOCKER,
      image: IMAGE,
      paths: p,
      tool,
      rustc: 'rustc 1.98.1 (x 2026-09-01)',
      cargo: 'cargo 1.98.1 (y 2026-08-05)',
      command: [
        'build',
        '--locked',
        '--offline',
        '--release',
        '--target',
        tool.target,
        '--package',
        tool.package,
      ],
      environment: ENV,
      owner: '1001:118',
      mbx: {
        version: '1.24.1',
        url: 'https://example.invalid/mbx.tgz',
        sha256: 'c'.repeat(64),
        maxTotalSize: '1GiB',
      },
    });
    expect((await checkElf(elf)).bytes).toBe(15);
    const calls = (await readFile(log, 'utf8')).trim().split('\n');
    const build =
      calls.find((line) => line.includes('/builder/build.sh')) ?? '';
    expect(build).toContain('--network none');
    expect(build).toContain('MBX_CACHE_DIR=/mbx');
    expect(build).toContain('MBX_GC_MAX_TOTAL_SIZE=1GiB');
    expect(build).toContain('--offline');
    const fetch = calls.find((line) => line.includes('cargo fetch')) ?? '';
    for (const line of [fetch, build]) {
      expect(line).toContain('RUSTUP_TOOLCHAIN=1.98.1');
      expect(line).toContain('FGB_OWNER=1001:118');
    }
    expect(fetch).toContain('chown -R "$FGB_OWNER" /cargo');
    expect(fetch).not.toContain('--target');
    expect(calls.filter((line) => line.startsWith('rm --force'))).toHaveLength(
      2,
    );
  });

  test('refuses dependencies one byte over the limit', async () => {
    const p = await paths();
    process.env.FAKE_FETCH_BYTES = '101';
    expect(
      await errorCode(
        fetchDependencies({
          run: runProcess,
          docker: DOCKER,
          image: IMAGE,
          paths: p,
          environment: ENV,
          limitBytes: 100,
          intervalMs: 10,
        }),
      ),
    ).toBe('LIMIT_EXCEEDED');
    expect(await readFile(log, 'utf8')).toContain('rm --force fgb-fetch-');
  });

  test('reports a failed build and leaves no ELF', async () => {
    const p = await paths();
    process.env.FAKE_BUILD_CODE = '101';
    const run = compile({
      run: runProcess,
      docker: DOCKER,
      image: IMAGE,
      paths: p,
      tool,
      rustc: 'r',
      cargo: 'c',
      environment: ENV,
      command: ['build', '--locked'],
      mbx: null,
    });
    expect(await errorCode(run)).toBe('EXTERNAL');
    expect(await readFile(log, 'utf8')).not.toContain('MBX_CACHE_DIR');
  });
});

describe('generateNotices', () => {
  const options = async () => ({
    run: runProcess,
    docker: DOCKER,
    image: IMAGE,
    paths: await paths(),
    outDirectory: join(await tempDir(), 'notices'),
    package: tool.package,
    target: tool.target,
    environment: ENV,
    owner: '1001:118',
  });

  test('runs cargo-about offline with the source read-only and returns its listing', async () => {
    const listing = await generateNotices(await options());
    expect(JSON.parse(new TextDecoder().decode(listing)).licenses).toHaveLength(
      1,
    );
    const call =
      (await readFile(log, 'utf8'))
        .split('\n')
        .find((line) => line.includes('/builder/notices.sh')) ?? '';
    expect(call).toContain('--network none');
    expect(call).toMatch(/:\/work:ro /);
    expect(call).toContain(
      '/builder/notices.sh biome_cli x86_64-unknown-linux-musl',
    );
    expect(call).toContain('RUSTUP_TOOLCHAIN=1.98.1');
    expect(await readFile(log, 'utf8')).toContain('rm --force fgb-notices-');
  });

  test('shows the output and refuses when cargo-about fails or writes nothing', async () => {
    process.env.FAKE_NOTICES_CODE = '1';
    const logged: string[] = [];
    expect(
      await errorCode(
        generateNotices({
          ...(await options()),
          log: (text) => logged.push(text),
        }),
      ),
    ).toBe('EXTERNAL');
    expect(logged.join('')).toContain('license not accepted');
    delete process.env.FAKE_NOTICES_CODE;
    process.env.FAKE_ABOUT_MISSING = '1';
    expect(await errorCode(generateNotices(await options()))).toBe(
      'VERIFY_FAILED',
    );
  });
});

describe('prepareExtras', () => {
  test('stores packages whose SHA256 matches and refuses one that differs', async () => {
    const bytes = new TextEncoder().encode('apk-bytes');
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const fetcher = async () => new Response(bytes);
    const directory = await tempDir();
    await prepareExtras(
      directory,
      [
        {
          name: 'make',
          url: 'https://example.invalid/make.apk',
          sha256,
          repository: 'https://example.invalid/aports',
          commit: 'b'.repeat(40),
        },
      ],
      null,
      { version: '0.9.2', url: 'https://example.invalid/about.tgz', sha256 },
      fetcher,
    );
    expect(await readdir(join(directory, 'apk'))).toEqual(['make.apk']);
    expect((await readdir(directory)).sort()).toEqual([
      'apk',
      'cargo-about.tar.gz',
    ]);
    const other = await tempDir();
    expect(
      await errorCode(
        prepareExtras(
          other,
          [
            {
              name: 'make',
              url: 'https://example.invalid/make.apk',
              sha256: '0'.repeat(64),
              repository: 'https://example.invalid/aports',
              commit: 'b'.repeat(40),
            },
          ],
          null,
          {
            version: '0.9.2',
            url: 'https://example.invalid/about.tgz',
            sha256,
          },
          fetcher,
        ),
      ),
    ).toBe('VERIFY_FAILED');
    expect(
      await errorCode(
        prepareExtras(
          await tempDir(),
          [],
          null,
          {
            version: '0.9.2',
            url: 'https://example.invalid/about.tgz',
            sha256: '0'.repeat(64),
          },
          fetcher,
        ),
      ),
    ).toBe('VERIFY_FAILED');
  });
});

describe('finalizeArtifacts', () => {
  async function elf(): Promise<string> {
    const path = join(await tempDir(), 'biome');
    await writeFile(path, '\x7fELFbinary');
    return path;
  }

  test('moves a verified ELF and build-info into the key directory', async () => {
    const root = await tempDir();
    const path = await elf();
    const { sha256 } = await checkElf(path);
    const result = await finalizeArtifacts({
      root,
      key: 'k'.repeat(64),
      elfPath: path,
      binary: 'biome',
      buildInfo: new TextEncoder().encode('{}'),
      license: LICENSE_BYTES,
      notices: NOTICES_BYTES,
      expectedElfSha256: sha256,
    });
    expect((await readdir(result.directory)).sort()).toEqual([
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'biome',
      'build-info.json',
    ]);
    expect(
      (await readdir(root)).filter((name) => name.startsWith('.staging')),
    ).toEqual([]);
  });

  test('leaves no staging behind when verification fails or the key already exists', async () => {
    const root = await tempDir();
    const path = await elf();
    expect(
      await errorCode(
        finalizeArtifacts({
          root,
          key: 'k',
          elfPath: path,
          binary: 'biome',
          buildInfo: new Uint8Array(),
          license: LICENSE_BYTES,
          notices: NOTICES_BYTES,
          expectedElfSha256: '0'.repeat(64),
        }),
      ),
    ).toBe('VERIFY_FAILED');
    const { sha256 } = await checkElf(path);
    await finalizeArtifacts({
      root,
      key: 'k',
      elfPath: path,
      binary: 'biome',
      buildInfo: new Uint8Array(),
      license: LICENSE_BYTES,
      notices: NOTICES_BYTES,
      expectedElfSha256: sha256,
    });
    expect(
      await errorCode(
        finalizeArtifacts({
          root,
          key: 'k',
          elfPath: path,
          binary: 'biome',
          buildInfo: new Uint8Array(),
          license: LICENSE_BYTES,
          notices: NOTICES_BYTES,
          expectedElfSha256: sha256,
        }),
      ),
    ).toBe('VERIFY_FAILED');
    expect((await readdir(root)).sort()).toEqual(['k']);
  });

  test('checkElf refuses a file that is not ELF and a missing file', async () => {
    const path = join(await tempDir(), 'x');
    await writeFile(path, '#!/bin/sh\n');
    expect(await errorCode(checkElf(path))).toBe('VERIFY_FAILED');
    expect(await errorCode(checkElf(join(await tempDir(), 'missing')))).toBe(
      'VERIFY_FAILED',
    );
  });
});

describe('parseToolsConfig', () => {
  test('accepts the shipped config and refuses unpinned images or unsafe names', async () => {
    const shipped = await Bun.file(
      new URL('../tools.json', import.meta.url),
    ).json();
    expect(parseToolsConfig(shipped).tools.biome?.binary).toBe('biome');
    expect(() =>
      parseToolsConfig({
        ...shipped,
        cargoAbout: { ...shipped.cargoAbout, sha256: 'short' },
      }),
    ).toThrow(BuildError);
    expect(() =>
      parseToolsConfig({ ...shipped, images: { '1.98.1': 'rust:1.98.1' } }),
    ).toThrow(BuildError);
    expect(() =>
      parseToolsConfig({
        ...shipped,
        tools: { x: { ...tool, binary: '../evil' } },
      }),
    ).toThrow(BuildError);
  });
});

describe('missing build output', () => {
  const base = async () => ({
    run: runProcess,
    docker: DOCKER,
    image: IMAGE,
    paths: await paths(),
    tool,
    rustc: 'r',
    cargo: 'c',
    command: ['build', '--locked'],
    environment: ENV,
    mbx: null,
  });

  test('names an unreachable symlinked target and shows the build output', async () => {
    process.env.FAKE_BUILD_SYMLINK = '1';
    const logged: string[] = [];
    const error = await compile({
      ...(await base()),
      log: (text) => logged.push(text),
    }).catch((caught: unknown) => caught);
    expect((error as BuildError).code).toBe('VERIFY_FAILED');
    expect((error as BuildError).message).toContain(
      'target is a symlink to /mbx/targets/v1/fake',
    );
    expect(logged.join('')).toContain('compiling with fake cargo');
  });

  test('shows the end of the build output when the build fails', async () => {
    process.env.FAKE_BUILD_CODE = '101';
    const logged: string[] = [];
    await compile({
      ...(await base()),
      log: (text) => logged.push(text),
    }).catch(() => undefined);
    expect(logged.join('')).toContain('error: could not compile');
    expect(logged.join('')).toContain('--- end of build output ---');
  });

  test('keeps only the last part of a long output', () => {
    const tail = outputTail('x'.repeat(40_000), 'END');
    expect(tail).toContain('END');
    expect(tail.length).toBeLessThan(33_000);
  });
});

describe('removeTree', () => {
  test('removes a plain tree without the container', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'x'), 'x');
    await removeTree(root, null);
    expect(await readdir(root).catch(() => null)).toBeNull();
  });

  test('falls back to removing through the pinned image when the runner cannot', async () => {
    const root = await tempDir();
    let attempts = 0;
    const remove = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('EACCES: permission denied');
    };
    await removeTree(
      root,
      { run: runProcess, docker: DOCKER, image: IMAGE },
      remove,
    );
    expect(attempts).toBe(2);
    const call = (await readFile(log, 'utf8')).trim().split('\n').pop() ?? '';
    expect(call).toContain('--network none');
    expect(call).toContain(`${root}:/tree`);
    expect(call).toContain('find /tree -mindepth 1 -delete');
  });

  test('reports a failed removal when there is no image to fall back to', async () => {
    const failing = async () => {
      throw new Error('EACCES: permission denied');
    };
    await expect(removeTree('/nonexistent', null, failing)).rejects.toThrow(
      'EACCES',
    );
  });
});
