import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_ELF_BYTES } from './artifact.ts';
import { fail } from './errors.ts';
import { type Fetcher, fetchLimited } from './http.ts';
import type { ExtraPackage } from './key.ts';
import { DEPENDENCY_LIMIT_BYTES, runMonitored } from './monitor.ts';
import type { Runner, RunResult } from './process.ts';
import { sha256File } from './source.ts';

export const MIN_FREE_DISK_BYTES = 20 * 1024 ** 3;
export const MAX_EXTRA_PACKAGE_BYTES = 134_217_728;

export interface ToolConfig {
  package: string;
  binary: string;
  target: string;
  environment: Record<string, string>;
  extraPackages: ExtraPackage[];
}

export interface MbxConfig {
  version: string;
  url: string;
  sha256: string;
  maxTotalSize: string;
}

export interface ToolsConfig {
  schemaVersion: 1;
  images: Record<string, string>;
  mbx: MbxConfig;
  tools: Record<string, ToolConfig>;
}

const IMAGE = /^([^\s@]+)@(sha256:[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

export function parseToolsConfig(value: unknown): ToolsConfig {
  const config = value as ToolsConfig;
  if (
    typeof config !== 'object' ||
    config === null ||
    config.schemaVersion !== 1
  )
    fail('INVALID_INPUT', 'tools config schemaVersion must be 1');
  for (const [channel, image] of Object.entries(config.images ?? {}))
    if (!IMAGE.test(image))
      fail(
        'INVALID_INPUT',
        `image for Rust ${channel} must be pinned by digest`,
      );
  if (!SHA256.test(config.mbx?.sha256 ?? ''))
    fail('INVALID_INPUT', 'mbx archive needs a SHA256');
  for (const [name, tool] of Object.entries(config.tools ?? {})) {
    if (
      !SAFE_NAME.test(tool.package) ||
      !SAFE_NAME.test(tool.binary) ||
      !SAFE_NAME.test(tool.target)
    )
      fail(
        'INVALID_INPUT',
        `tool ${name} has an unsafe package, binary or target name`,
      );
    for (const extra of tool.extraPackages)
      if (!SHA256.test(extra.sha256) || !SAFE_NAME.test(extra.name))
        fail(
          'INVALID_INPUT',
          `tool ${name} extra package needs a safe name and a SHA256`,
        );
  }
  return config;
}

export async function readToolchainChannel(directory: string): Promise<string> {
  const toml = await readFile(
    join(directory, 'rust-toolchain.toml'),
    'utf8',
  ).catch(() => undefined);
  if (toml !== undefined) {
    const parsed = Bun.TOML.parse(toml) as {
      toolchain?: { channel?: unknown };
    };
    const channel = parsed.toolchain?.channel;
    if (typeof channel !== 'string')
      fail('INVALID_INPUT', 'rust-toolchain.toml has no channel');
    return channel;
  }
  const plain = await readFile(join(directory, 'rust-toolchain'), 'utf8').catch(
    () => undefined,
  );
  if (plain !== undefined && plain.trim() !== '') return plain.trim();
  fail('INVALID_INPUT', 'the source pins no Rust toolchain');
}

export async function checkDiskFree(
  path: string,
  minBytes = MIN_FREE_DISK_BYTES,
  probe: (path: string) => Promise<{ bavail: number; bsize: number }> = statfs,
): Promise<number> {
  const info = await probe(path);
  const free = info.bavail * info.bsize;
  if (free < minBytes)
    fail(
      'LIMIT_EXCEEDED',
      `only ${free} bytes free on the runner, ${minBytes} required`,
    );
  return free;
}

export interface ImageToolchain {
  image: string;
  rustcVerbose: string;
  rustc: string;
  cargo: string;
}

export async function inspectImage(
  run: Runner,
  docker: string,
  image: string,
  signal?: AbortSignal,
): Promise<ImageToolchain> {
  const match = IMAGE.exec(image);
  if (match === null) fail('INVALID_INPUT', 'image must be pinned by digest');
  const opts = signal === undefined ? {} : { signal };
  if ((await run(docker, ['pull', '--quiet', image], opts)).code !== 0)
    fail('EXTERNAL', 'image pull failed');
  const inspect = await run(
    docker,
    ['image', 'inspect', '--format', '{{json .RepoDigests}}', image],
    opts,
  );
  let digests: unknown;
  try {
    digests = JSON.parse(inspect.stdout);
  } catch {
    fail('VERIFY_FAILED', 'image inspect returned no digests');
  }
  if (
    !Array.isArray(digests) ||
    !digests.some(
      (entry) => typeof entry === 'string' && entry.endsWith(`@${match[2]}`),
    )
  )
    fail(
      'VERIFY_FAILED',
      'pulled image digest differs from the configured digest',
    );
  const probe = await run(
    docker,
    [
      'run',
      '--rm',
      '--network',
      'none',
      image,
      'sh',
      '-c',
      "rustc -vV && echo '---' && rustc --version && cargo --version",
    ],
    opts,
  );
  if (probe.code !== 0)
    fail('EXTERNAL', 'toolchain probe failed inside the image');
  const [verbose, versions] = probe.stdout.split('---\n');
  const [rustc, cargo] = (versions ?? '').trim().split('\n');
  if (verbose === undefined || rustc === undefined || cargo === undefined)
    fail('VERIFY_FAILED', 'toolchain probe output is incomplete');
  return { image, rustcVerbose: verbose.trim(), rustc, cargo };
}

export function checkToolchain(rustcVerbose: string, channel: string): void {
  const release = /^release: (.+)$/m.exec(rustcVerbose)?.[1]?.trim();
  if (release !== channel)
    fail(
      'VERIFY_FAILED',
      `image has Rust ${release ?? 'unknown'}, the source pins ${channel}`,
    );
}

export async function prepareExtras(
  directory: string,
  extras: readonly ExtraPackage[],
  mbx: MbxConfig | null,
  fetcher?: Fetcher,
): Promise<void> {
  await mkdir(join(directory, 'apk'), { recursive: true });
  for (const extra of extras) {
    const result = await fetchLimited(extra.url, {
      limitBytes: MAX_EXTRA_PACKAGE_BYTES,
      expectedSha256: extra.sha256,
      ...(fetcher === undefined ? {} : { fetcher }),
    });
    await writeFile(join(directory, 'apk', `${extra.name}.apk`), result.bytes, {
      flag: 'wx',
    });
  }
  if (mbx !== null) {
    const result = await fetchLimited(mbx.url, {
      limitBytes: MAX_EXTRA_PACKAGE_BYTES,
      expectedSha256: mbx.sha256,
      ...(fetcher === undefined ? {} : { fetcher }),
    });
    await writeFile(join(directory, 'mbx.tar.gz'), result.bytes, {
      flag: 'wx',
    });
  }
}

export interface ContainerPaths {
  source: string;
  cargoHome: string;
  builderDir: string;
  dependencyDir: string;
  mbxCache: string | null;
}

// The containers run as root, so they hand what they wrote back to the
// runner's user; otherwise the runner cannot remove its own work directory.
const OUTPUT_TAIL_BYTES = 32 * 1024;

const writeStderr = (text: string) => {
  process.stderr.write(text);
};

export function outputTail(stdout: string, stderr: string): string {
  const text = `${stdout}${stderr}`;
  const tail =
    text.length > OUTPUT_TAIL_BYTES ? text.slice(-OUTPUT_TAIL_BYTES) : text;
  return `--- last ${tail.length} characters of the build output ---\n${tail}\n--- end of build output ---\n`;
}

export function hostOwner(): string {
  return `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
}

function environmentArgs(
  environment: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(environment).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`,
  ]);
}

async function removeContainer(
  run: Runner,
  docker: string,
  name: string,
): Promise<void> {
  await run(docker, ['rm', '--force', name]).catch(() => undefined);
}

export async function fetchDependencies(options: {
  run: Runner;
  docker: string;
  image: string;
  paths: ContainerPaths;
  target: string;
  environment: Readonly<Record<string, string>>;
  owner?: string;
  limitBytes?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}): Promise<number> {
  const name = `fgb-fetch-${randomUUID()}`;
  try {
    const result = await runMonitored(
      options.docker,
      [
        'run',
        '--rm',
        '--name',
        name,
        '-v',
        `${options.paths.source}:/work:ro`,
        '-v',
        `${options.paths.cargoHome}:/cargo`,
        '-e',
        'CARGO_HOME=/cargo',
        ...environmentArgs(options.environment),
        '-e',
        `FGB_OWNER=${options.owner ?? hostOwner()}`,
        '-w',
        '/work',
        options.image,
        'sh',
        '-c',
        'cargo fetch --locked --target "$1"; status=$?; chown -R "$FGB_OWNER" /cargo; exit "$status"',
        'fetch',
        options.target,
      ],
      {
        watch: [
          join(options.paths.cargoHome, 'registry'),
          join(options.paths.cargoHome, 'git'),
        ],
        limitBytes: options.limitBytes ?? DEPENDENCY_LIMIT_BYTES,
        ...(options.intervalMs === undefined
          ? {}
          : { intervalMs: options.intervalMs }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    if (result.code !== 0) fail('EXTERNAL', 'cargo fetch failed');
    return result.bytes;
  } finally {
    await removeContainer(options.run, options.docker, name);
  }
}

export async function compile(options: {
  run: Runner;
  docker: string;
  image: string;
  paths: ContainerPaths;
  tool: ToolConfig;
  rustc: string;
  cargo: string;
  command: readonly string[];
  environment: Readonly<Record<string, string>>;
  owner?: string;
  mbx: MbxConfig | null;
  signal?: AbortSignal;
  log?: (text: string) => void;
}): Promise<string> {
  const name = `fgb-build-${randomUUID()}`;
  let output: RunResult = { code: 0, stdout: '', stderr: '' };
  const env = [
    ...environmentArgs(options.environment),
    '-e',
    `FGB_OWNER=${options.owner ?? hostOwner()}`,
  ];
  const mbx =
    options.mbx === null || options.paths.mbxCache === null
      ? []
      : [
          '-v',
          `${options.paths.mbxCache}:/mbx`,
          '-e',
          'MBX_CACHE_DIR=/mbx',
          '-e',
          'MBX_DISPLAY=plain',
          '-e',
          `MBX_GC_MAX_TOTAL_SIZE=${options.mbx.maxTotalSize}`,
          '-e',
          'FGB_MBX_ARCHIVE=/dependency/mbx.tar.gz',
        ];
  try {
    const result = await options.run(
      options.docker,
      [
        'run',
        '--rm',
        '--name',
        name,
        '--network',
        'none',
        '-v',
        `${options.paths.source}:/work`,
        '-v',
        `${options.paths.cargoHome}:/cargo`,
        '-v',
        `${options.paths.builderDir}:/builder:ro`,
        '-v',
        `${options.paths.dependencyDir}:/dependency:ro`,
        ...mbx,
        '-e',
        'CARGO_HOME=/cargo',
        ...env,
        '-w',
        '/work',
        options.image,
        'sh',
        '/builder/build.sh',
        options.rustc,
        options.cargo,
        ...options.command,
      ],
      options.signal === undefined ? {} : { signal: options.signal },
    );
    if (options.signal?.aborted) fail('ABORTED', 'build was stopped');
    if (result.code !== 0) {
      (options.log ?? writeStderr)(outputTail(result.stdout, result.stderr));
      fail('EXTERNAL', `build failed with exit code ${result.code}`);
    }
    output = result;
  } finally {
    await removeContainer(options.run, options.docker, name);
  }
  const elf = join(
    options.paths.source,
    'target',
    options.tool.target,
    'release',
    options.tool.binary,
  );
  if ((await lstat(elf).catch(() => undefined)) === undefined) {
    (options.log ?? writeStderr)(outputTail(output.stdout, output.stderr));
    const target = join(options.paths.source, 'target');
    const link = await readlink(target).catch(() => undefined);
    fail(
      'VERIFY_FAILED',
      link === undefined
        ? 'build produced no binary'
        : `build produced no binary the runner can reach: target is a symlink to ${link}`,
    );
  }
  return elf;
}

// Removes a tree the containers may have left owned by root: a plain removal
// first, then one through the pinned image when the runner's user cannot.
export async function removeTree(
  path: string,
  fallback: { run: Runner; docker: string; image: string } | null,
  remove: (path: string) => Promise<void> = (target) =>
    rm(target, { recursive: true, force: true }),
): Promise<void> {
  try {
    await remove(path);
    return;
  } catch (error) {
    if (fallback === null) throw error;
  }
  const result = await fallback.run(fallback.docker, [
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${path}:/tree`,
    fallback.image,
    'sh',
    '-c',
    'find /tree -mindepth 1 -delete',
  ]);
  if (result.code !== 0)
    fail('EXTERNAL', `could not remove ${path} through the container`);
  await remove(path);
}

export async function checkElf(
  path: string,
): Promise<{ sha256: string; bytes: number }> {
  const handle = await open(path, 'r').catch(() =>
    fail('VERIFY_FAILED', 'build produced no binary'),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile())
      fail('VERIFY_FAILED', 'build output is not a regular file');
    if (info.size > MAX_ELF_BYTES)
      fail('LIMIT_EXCEEDED', `ELF is larger than ${MAX_ELF_BYTES} bytes`);
    const magic = new Uint8Array(4);
    await handle.read(magic, 0, 4, 0);
    if (
      magic[0] !== 0x7f ||
      magic[1] !== 0x45 ||
      magic[2] !== 0x4c ||
      magic[3] !== 0x46
    )
      fail('VERIFY_FAILED', 'build output is not an ELF file');
    return { sha256: await sha256File(path), bytes: info.size };
  } finally {
    await handle.close();
  }
}

export async function finalizeArtifacts(options: {
  root: string;
  key: string;
  elfPath: string;
  binary: string;
  buildInfo: Uint8Array;
  expectedElfSha256: string;
}): Promise<{ directory: string; buildInfoSha256: string }> {
  const staging = join(options.root, `.staging-${randomUUID()}`);
  const final = join(options.root, options.key);
  await mkdir(staging, { recursive: false }).catch(async () => {
    await mkdir(options.root, { recursive: true });
    await mkdir(staging);
  });
  try {
    await copyFile(options.elfPath, join(staging, options.binary));
    await writeFile(join(staging, 'build-info.json'), options.buildInfo, {
      flag: 'wx',
    });
    const elf = await checkElf(join(staging, options.binary));
    if (elf.sha256 !== options.expectedElfSha256)
      fail('VERIFY_FAILED', 'staged ELF differs from the built ELF');
    const buildInfoSha256 = await sha256File(join(staging, 'build-info.json'));
    await rename(staging, final).catch(() =>
      fail('VERIFY_FAILED', 'an artifact for this key already exists'),
    );
    return { directory: final, buildInfoSha256 };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
