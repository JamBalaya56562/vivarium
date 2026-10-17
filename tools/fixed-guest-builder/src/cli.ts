import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyArtifactSet } from './artifact.ts';
import { bumpGuest } from './bump.ts';
import { checkNotBusy } from './busy.ts';
import { parseAllowlist } from './declaration.ts';
import { BuildError } from './errors.ts';
import { createGitHubApi, type GitHubApi } from './github.ts';
import { type BuildDeps, runBuild } from './pipeline.ts';
import { runProcess } from './process.ts';
import {
  checkApprovalGate,
  makePublishPlan,
  publishSet,
  type SetIdentity,
} from './release.ts';
import { BUILD_INFO_ASSET, CATALOG_ASSET } from './reuse.ts';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
}

export interface CliDeps {
  api?: (repository: string, token: string) => GitHubApi;
  build?: Partial<BuildDeps>;
}

const PACKAGE_ROOT = resolve(import.meta.dir, '..');

export function parseFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (!arg.startsWith('--'))
      throw new BuildError('INVALID_INPUT', `unexpected argument: ${arg}`);
    const name = arg.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new BuildError('INVALID_INPUT', `--${name} needs a value`);
    if (name in flags)
      throw new BuildError('INVALID_INPUT', `--${name} is given twice`);
    flags[name] = value;
    index += 1;
  }
  return flags;
}

function required(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined)
    throw new BuildError('INVALID_INPUT', `--${name} is required`);
  return value;
}

function runId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new BuildError('INVALID_INPUT', 'run id must be a positive integer');
  return id;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new BuildError('INVALID_INPUT', `cannot read JSON from ${path}`);
  }
}

function environment(io: CliIo, name: string): string {
  const value = io.env[name];
  if (value === undefined || value === '')
    throw new BuildError('INVALID_INPUT', `${name} is not set`);
  return value;
}

async function readSet(directory: string, binary: string) {
  return {
    elf: new Uint8Array(await readFile(join(directory, binary))),
    buildInfo: new Uint8Array(
      await readFile(join(directory, BUILD_INFO_ASSET)),
    ),
    catalog: new Uint8Array(await readFile(join(directory, CATALOG_ASSET))),
  };
}

function identityFrom(flags: Record<string, string>): SetIdentity {
  return {
    tool: required(flags, 'tool'),
    binary: required(flags, 'binary'),
    key: required(flags, 'key'),
    repository: required(flags, 'repository'),
    commit: required(flags, 'commit'),
  };
}

async function command(
  name: string | undefined,
  args: readonly string[],
  io: CliIo,
  deps: CliDeps,
): Promise<unknown> {
  const flags = parseFlags(args);
  const api = () =>
    (deps.api ?? defaultApi)(
      environment(io, 'GITHUB_REPOSITORY'),
      environment(io, 'GITHUB_TOKEN'),
    );
  switch (name) {
    case 'build': {
      const id = runId(environment(io, 'GITHUB_RUN_ID'));
      await checkNotBusy(api(), required(flags, 'workflow'), id);
      const declaration = (await readJson(
        required(flags, 'declaration'),
      )) as Record<string, unknown>;
      const { sourcePatches, ...guest } = declaration;
      const work = resolve(required(flags, 'work'));
      const out = resolve(required(flags, 'out'));
      await mkdir(work, { recursive: true });
      await mkdir(out, { recursive: true });
      const receipt = await runBuild(
        {
          declaration: guest,
          ...(Array.isArray(sourcePatches)
            ? { sourcePatches: sourcePatches as never }
            : {}),
          allowlist: parseAllowlist(
            await readJson(join(PACKAGE_ROOT, 'allowlist.json')),
          ),
          toolsConfig: await readJson(join(PACKAGE_ROOT, 'tools.json')),
          workDirectory: work,
          outputDirectory: out,
          builderDirectory: join(PACKAGE_ROOT, 'container'),
          patchDirectory: join(PACKAGE_ROOT, 'patches'),
          mbxCache:
            flags['mbx-cache'] === undefined || flags['mbx-cache'] === 'none'
              ? null
              : resolve(flags['mbx-cache']),
          runUrl: `${io.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${environment(io, 'GITHUB_REPOSITORY')}/actions/runs/${id}`,
          runnerInfo: {
            bun: Bun.version,
            node: process.versions.node ?? 'unknown',
            runner: io.env.RUNNER_OS ?? 'unknown',
          },
        },
        { run: runProcess, docker: flags.docker ?? 'docker', ...deps.build },
      );
      if (flags.receipt !== undefined)
        await writeFile(
          flags.receipt,
          `${JSON.stringify(receipt, null, 2)}\n`,
          { flag: 'wx' },
        );
      return receipt;
    }
    case 'plan': {
      const identity = identityFrom(flags);
      const verified = verifyArtifactSet(
        await readSet(required(flags, 'artifacts'), identity.binary),
        {
          buildKey: identity.key,
          tool: identity.tool,
          repository: identity.repository,
          commit: identity.commit,
        },
      );
      const plan = makePublishPlan({
        identity,
        verified,
        buildRunId: runId(required(flags, 'build-run-id')),
        rollbackPlan: required(flags, 'rollback'),
        approvalReference: required(flags, 'approval-reference'),
      });
      await writeFile(required(flags, 'plan-out'), plan.bytes, { flag: 'wx' });
      return { planSha256: plan.sha256, plan: plan.plan };
    }
    case 'release': {
      const github = api();
      await checkNotBusy(
        github,
        required(flags, 'workflow'),
        runId(environment(io, 'GITHUB_RUN_ID')),
      );
      await checkApprovalGate(github);
      const identity = identityFrom(flags);
      return publishSet({
        api: github,
        identity,
        files: await readSet(required(flags, 'artifacts'), identity.binary),
        planBytes: new Uint8Array(await readFile(required(flags, 'plan'))),
        approvedPlanSha256: required(flags, 'plan-sha256'),
      }).then((outcome) => ({
        status: outcome.status,
        tag: outcome.tag,
        elfSha256: outcome.verified.elfSha256,
      }));
    }
    case 'bump': {
      await checkNotBusy(
        api(),
        required(flags, 'workflow'),
        runId(environment(io, 'GITHUB_RUN_ID')),
      );
      const work = resolve(required(flags, 'work'));
      await mkdir(work, { recursive: true });
      const record = await bumpGuest({
        recipePath: required(flags, 'recipe'),
        tool: required(flags, 'tool'),
        allowlist: parseAllowlist(
          await readJson(join(PACKAGE_ROOT, 'allowlist.json')),
        ),
        run: runProcess,
        workDirectory: work,
      });
      return { changed: record !== null, record };
    }
    default:
      throw new BuildError(
        'INVALID_INPUT',
        'usage: cli.ts <build|plan|release|bump> [--flag value]...',
      );
  }
}

// Exit 2 marks BUSY so a caller can tell "start again later" from a refusal.
export async function main(
  argv: readonly string[],
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> {
  const secrets = [io.env.GITHUB_TOKEN, io.env.ACTIONS_RUNTIME_TOKEN].filter(
    (value): value is string => !!value,
  );
  const redact = (text: string) =>
    secrets.reduce((result, secret) => result.split(secret).join('***'), text);
  try {
    const result = await command(argv[0], argv.slice(1), io, deps);
    io.stdout(redact(`${JSON.stringify(result, null, 2)}\n`));
    return 0;
  } catch (error) {
    const code = error instanceof BuildError ? error.code : 'EXTERNAL';
    const message = error instanceof Error ? error.message : 'unknown failure';
    io.stderr(redact(`${JSON.stringify({ error: { code, message } })}\n`));
    return code === 'BUSY' ? 2 : 1;
  }
}

export const defaultApi = (repository: string, token: string): GitHubApi =>
  createGitHubApi({ repository, token });

export function processIo(): CliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
  };
}

if (import.meta.main)
  process.exit(await main(process.argv.slice(2), processIo()));
