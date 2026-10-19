import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type GuestBuildInfo,
  makeCatalog,
  verifyArtifactSet,
} from './artifact.ts';
import {
  checkDiskFree,
  checkElf,
  checkToolchain,
  compile,
  fetchDependencies,
  finalizeArtifacts,
  inspectImage,
  parseToolsConfig,
  prepareExtras,
  readToolchainChannel,
  removeTree,
} from './build.ts';
import { BUILD_DEADLINE_MS, withDeadline } from './deadline.ts';
import { type Allowlist, validateDeclaration } from './declaration.ts';
import { fail } from './errors.ts';
import type { Fetcher } from './http.ts';
import {
  type BuilderIdentity,
  builderHash,
  buildKey,
  canonicalJson,
  keyDependencies,
  sha256Hex,
} from './key.ts';
import { checkCargoSources } from './lockfile.ts';
import { directoryBytes, runMonitored, SOURCE_LIMIT_BYTES } from './monitor.ts';
import type { Runner } from './process.ts';
import {
  assetUrl,
  BUILD_INFO_ASSET,
  CATALOG_ASSET,
  findPublished,
  RELEASE_REPOSITORY,
  releaseTag,
} from './reuse.ts';
import {
  applyPatches,
  fetchSource,
  type SourcePatch,
  sha256File,
  verifyDependencyReachable,
} from './source.ts';

export interface BuildRequest {
  declaration: unknown;
  sourcePatches?: SourcePatch[];
  allowlist: Allowlist;
  toolsConfig: unknown;
  workDirectory: string;
  outputDirectory: string;
  builderDirectory: string;
  patchDirectory: string;
  mbxCache: string | null;
  // The keys the workflow asked actions/cache to restore and the one it matched.
  mbxCacheKeys?: { requested: string | null; matched: string | null };
  runUrl: string;
  runnerInfo: Record<string, string>;
}

export interface BuildDeps {
  run: Runner;
  docker: string;
  fetcher?: Fetcher;
  cloneUrl?: (repository: string) => string;
  releaseRepository?: string;
  deadlineMs?: number;
  sourceLimitBytes?: number;
  dependencyLimitBytes?: number;
  minFreeDiskBytes?: number;
  monitorIntervalMs?: number;
  killGraceMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
}

export interface BuildReceipt {
  schemaVersion: 1;
  buildKey: string;
  tag: string;
  compiled: boolean;
  elfSha256: string;
  buildInfoSha256: string;
  catalogSha256: string;
  source: { repository: string; commit: string };
  artifactDirectory: string | null;
  sizes: {
    sourceBytes: number;
    dependencyBytes: number | null;
    freeDiskBytes: number;
  };
  durationsMs: Record<string, number>;
  recordedAt: string;
  ciRunUrl: string;
}

function watchedGit(
  run: Runner,
  directory: string,
  limitBytes: number,
  intervalMs: number | undefined,
  killGraceMs: number | undefined,
): Runner {
  return async (command, args, options = {}) => {
    if (command !== 'git' || (args[0] !== 'clone' && args[0] !== 'checkout'))
      return run(command, args, options);
    const result = await runMonitored(command, args, {
      ...options,
      watch: [directory],
      limitBytes,
      ...(intervalMs === undefined ? {} : { intervalMs }),
      ...(killGraceMs === undefined ? {} : { killGraceMs }),
    });
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  };
}

async function runnerScriptsSha256(builderDirectory: string): Promise<string> {
  const src = join(builderDirectory, '..', 'src');
  const names = (await readdir(src).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.ts'))
    .sort();
  const parts: string[] = [];
  for (const name of names)
    parts.push(`${name}:${await sha256File(join(src, name))}`);
  return sha256Hex(parts.join('\n'));
}

export async function runBuild(
  request: BuildRequest,
  deps: BuildDeps,
): Promise<BuildReceipt> {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const durations: Record<string, number> = {};
  const timed = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
    const begin = Date.now();
    try {
      return await task();
    } finally {
      durations[name] = Date.now() - begin;
    }
  };
  const config = parseToolsConfig(request.toolsConfig);
  const declaration = validateDeclaration(
    request.declaration,
    request.allowlist,
  );
  const tool = config.tools[declaration.tool];
  if (tool === undefined)
    fail(
      'INVALID_INPUT',
      `no build configuration for tool ${declaration.tool}`,
    );
  const source = {
    repository: declaration.repository,
    commit: declaration.commit,
  };
  const sourceDir = join(request.workDirectory, 'source');
  const paths = {
    source: sourceDir,
    cargoHome: join(request.workDirectory, 'cargo-home'),
    builderDir: request.builderDirectory,
    dependencyDir: join(request.workDirectory, 'dependency'),
    mbxCache: request.mbxCache,
  };

  let pulledImage: string | undefined;
  return withDeadline(
    async (signal) => {
      // Counted before any container can write into the cache directory.
      const mbxCacheRestored =
        request.mbxCache === null
          ? null
          : (await readdir(request.mbxCache).catch(() => [])).length > 0;
      await mkdir(request.workDirectory, { recursive: true });
      await mkdir(request.outputDirectory, { recursive: true });
      const freeDisk = await checkDiskFree(
        request.workDirectory,
        deps.minFreeDiskBytes,
      );
      await timed('source', () =>
        fetchSource({
          repository: declaration.repository,
          commit: declaration.commit,
          directory: sourceDir,
          run: watchedGit(
            deps.run,
            sourceDir,
            deps.sourceLimitBytes ?? SOURCE_LIMIT_BYTES,
            deps.monitorIntervalMs,
            deps.killGraceMs,
          ),
          signal,
          ...(deps.cloneUrl === undefined ? {} : { cloneUrl: deps.cloneUrl }),
        }),
      );
      const sourceBytes = await directoryBytes([sourceDir]);
      const channel = await readToolchainChannel(sourceDir);
      const image = config.images[channel];
      if (image === undefined)
        fail('INVALID_INPUT', `no pinned image for Rust ${channel}`);
      const toolchain = await timed('image', () =>
        inspectImage(deps.run, deps.docker, image, signal),
      );
      checkToolchain(toolchain.rustcVerbose, channel);
      pulledImage = image;
      // The source's rust-toolchain file would otherwise make rustup fetch a
      // toolchain from the network inside the containers.
      // mbx moves a default target directory into its own cache and leaves a
      // symlink the runner cannot follow; an explicit one stays in the source.
      const environment = {
        ...tool.environment,
        RUSTUP_TOOLCHAIN: channel,
        CARGO_TARGET_DIR: '/work/target',
      };
      const patches = request.sourcePatches ?? [];
      await applyPatches(sourceDir, patches, deps.run, request.patchDirectory);
      const lock = await checkCargoSources(sourceDir, request.allowlist);
      const command = [
        'build',
        '--locked',
        '--offline',
        '--release',
        '--target',
        tool.target,
        '--package',
        tool.package,
      ];
      const mbx = request.mbxCache === null ? null : config.mbx;
      const builder: BuilderIdentity = {
        schemaVersion: 1,
        containerScriptSha256: await sha256File(
          join(request.builderDirectory, 'build.sh'),
        ),
        image,
        mbx: mbx === null ? null : { version: mbx.version, sha256: mbx.sha256 },
        rustcVerbose: toolchain.rustcVerbose,
        cargo: toolchain.cargo,
        command,
        environment,
      };
      const sourcePatches = patches.map((patch) => ({
        name: patch.name,
        sha256: patch.sha256,
      }));
      const dependencies = keyDependencies(
        source,
        lock.cargoLockSha256,
        tool.extraPackages,
      );
      const hash = builderHash(builder);
      const key = buildKey({
        tool: declaration.tool,
        ...source,
        target: tool.target,
        rustc: toolchain.rustc,
        sourcePatches,
        dependencies,
        builderHash: hash,
      });
      const tag = releaseTag(declaration.tool, key);
      const releaseRepository = deps.releaseRepository ?? RELEASE_REPOSITORY;
      const reused = await timed('reuse-lookup', () =>
        findPublished({
          repository: releaseRepository,
          tool: declaration.tool,
          binary: tool.binary,
          key,
          source,
          signal,
          ...(deps.fetcher === undefined ? {} : { fetcher: deps.fetcher }),
        }),
      );
      const receipt = (
        fields: Pick<
          BuildReceipt,
          | 'compiled'
          | 'elfSha256'
          | 'buildInfoSha256'
          | 'catalogSha256'
          | 'artifactDirectory'
        >,
        dependencyBytes: number | null,
      ): BuildReceipt => ({
        schemaVersion: 1,
        buildKey: key,
        tag,
        ...fields,
        source,
        sizes: { sourceBytes, dependencyBytes, freeDiskBytes: freeDisk },
        durationsMs: { ...durations, total: Date.now() - started },
        recordedAt: now().toISOString(),
        ciRunUrl: request.runUrl,
      });
      if (reused !== null)
        return receipt(
          {
            compiled: false,
            elfSha256: reused.elfSha256,
            buildInfoSha256: reused.buildInfoSha256,
            catalogSha256: reused.catalogSha256,
            artifactDirectory: null,
          },
          null,
        );

      await timed('dependency-sources', async () => {
        for (const [index, dependency] of lock.gitDependencies.entries()) {
          const directory = join(
            request.workDirectory,
            'git-dependencies',
            String(index),
          );
          await verifyDependencyReachable({
            ...dependency,
            directory,
            run: watchedGit(
              deps.run,
              directory,
              deps.sourceLimitBytes ?? SOURCE_LIMIT_BYTES,
              deps.monitorIntervalMs,
              deps.killGraceMs,
            ),
            signal,
            ...(deps.cloneUrl === undefined ? {} : { cloneUrl: deps.cloneUrl }),
          });
        }
      });
      await prepareExtras(
        paths.dependencyDir,
        tool.extraPackages,
        mbx,
        deps.fetcher,
      );
      await mkdir(paths.cargoHome, { recursive: true });
      const dependencyBytes = await timed('dependencies', () =>
        fetchDependencies({
          run: deps.run,
          docker: deps.docker,
          image,
          paths,
          target: tool.target,
          environment,
          signal,
          ...(deps.dependencyLimitBytes === undefined
            ? {}
            : { limitBytes: deps.dependencyLimitBytes }),
          ...(deps.monitorIntervalMs === undefined
            ? {}
            : { intervalMs: deps.monitorIntervalMs }),
        }),
      );
      const elfPath = await timed('compile', () =>
        compile({
          run: deps.run,
          docker: deps.docker,
          image,
          paths,
          tool,
          rustc: toolchain.rustc,
          cargo: toolchain.cargo,
          command,
          environment,
          mbx,
          signal,
        }),
      );
      const elf = await checkElf(elfPath);
      const buildInfo: GuestBuildInfo = {
        schemaVersion: 1,
        tool: declaration.tool,
        versionOrName: declaration.commit,
        source,
        target: 'x86_64-unknown-linux-musl',
        rustc: toolchain.rustc,
        sourcePatches,
        dependencies,
        builderHash: hash,
        buildKey: key,
        elfSha256: elf.sha256,
        // Reference only: not part of the key.
        reference: {
          builder,
          fixture: declaration.fixture,
          declarationReference: declaration.reference ?? null,
          runner: {
            ...request.runnerInfo,
            runnerScriptsSha256: await runnerScriptsSha256(
              request.builderDirectory,
            ),
          },
          mbxCacheRestored,
          mbxCacheKeys:
            request.mbxCache === null ? null : (request.mbxCacheKeys ?? null),
          ciRunUrl: request.runUrl,
        },
      };
      // formicarium hashes the canonical form; any other spelling breaks the digest.
      const buildInfoBytes = new TextEncoder().encode(canonicalJson(buildInfo));
      const final = await finalizeArtifacts({
        root: request.outputDirectory,
        key,
        elfPath,
        binary: tool.binary,
        buildInfo: buildInfoBytes,
        expectedElfSha256: elf.sha256,
      });
      const elfBytes = new Uint8Array(
        await readFile(join(final.directory, tool.binary)),
      );
      const catalog = makeCatalog(
        buildInfo,
        buildInfoBytes,
        elfBytes,
        assetUrl(releaseRepository, tag, tool.binary),
      );
      const catalogBytes = new TextEncoder().encode(
        `${JSON.stringify(catalog, null, 2)}\n`,
      );
      await writeFile(join(final.directory, CATALOG_ASSET), catalogBytes, {
        flag: 'wx',
      });
      const verified = verifyArtifactSet(
        {
          elf: elfBytes,
          buildInfo: new Uint8Array(
            await readFile(join(final.directory, BUILD_INFO_ASSET)),
          ),
          catalog: catalogBytes,
        },
        { buildKey: key, tool: declaration.tool, ...source },
      );
      return receipt(
        {
          compiled: true,
          elfSha256: verified.elfSha256,
          buildInfoSha256: verified.buildInfoSha256,
          catalogSha256: verified.catalogSha256,
          artifactDirectory: final.directory,
        },
        dependencyBytes,
      );
    },
    {
      deadlineMs: deps.deadlineMs ?? BUILD_DEADLINE_MS,
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
      cleanup: async () => {
        await removeTree(
          request.workDirectory,
          pulledImage === undefined
            ? null
            : { run: deps.run, docker: deps.docker, image: pulledImage },
        );
        for (const name of await readdir(request.outputDirectory).catch(
          () => [] as string[],
        ))
          if (name.startsWith('.staging-'))
            await rm(join(request.outputDirectory, name), {
              recursive: true,
              force: true,
            });
      },
    },
  );
}
