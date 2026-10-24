import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type GuestSet,
  LICENSE_ASSET,
  MAX_METADATA_BYTES,
  NOTICES_ASSET,
  parseUniqueJson,
  type VerifiedGuestSet,
  verifyGuestSet,
} from './artifact.ts';
import { parseToolsConfig } from './build.ts';
import { fail } from './errors.ts';
import type { GitHubApi } from './github.ts';
import type { Fetcher } from './http.ts';
import {
  type ExternalOperation,
  makePublishPlan,
  type SetIdentity,
} from './release.ts';
import {
  assetUrl,
  BUILD_INFO_ASSET,
  CATALOG_ASSET,
  findPublished,
  RELEASE_REPOSITORY,
  releaseTag,
  setAssets,
} from './reuse.ts';

export const BUILD_WORKFLOW_PATH = '.github/workflows/fixed-guest-build.yml';
export const RECEIPT_FILE = 'receipt.json';
export const ROLLBACK_PLAN =
  'Published Releases are never deleted or replaced. To undo, point the recipe back to the previous build key; the new Release stays.';

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const TOOL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface BuildReceiptView {
  buildKey: string;
  tag: string;
  compiled: boolean;
  elfSha256: string;
  buildInfoSha256: string;
  catalogSha256: string;
  source: { repository: string; commit: string };
  ciRunUrl: string;
}

export interface PreparedSet {
  identity: SetIdentity;
  compiled: boolean;
  runUrl: string;
  files: GuestSet;
  verified: VerifiedGuestSet;
}

export function buildRunUrl(id: number): string {
  return `https://github.com/${RELEASE_REPOSITORY}/actions/runs/${id}`;
}

// The run object carries no inputs, so the identity comes from the artifact
// and the run only vouches for where and how that artifact was made.
export async function checkBuildRun(
  api: GitHubApi,
  buildRunId: number,
  currentRunId: number,
): Promise<void> {
  const run = await api.workflowRun(buildRunId);
  if (run.id !== buildRunId)
    fail('VERIFY_FAILED', 'GitHub returned another run');
  if (
    run.repository !== RELEASE_REPOSITORY ||
    run.headRepository !== RELEASE_REPOSITORY
  )
    fail('VERIFY_FAILED', `the build run is not from ${RELEASE_REPOSITORY}`);
  if (run.path !== BUILD_WORKFLOW_PATH)
    fail('VERIFY_FAILED', `the run is not of ${BUILD_WORKFLOW_PATH}`);
  if (run.headBranch !== 'main' || run.event !== 'workflow_dispatch')
    fail('VERIFY_FAILED', 'the build run is not a workflow_dispatch on main');
  if (run.htmlUrl !== buildRunUrl(buildRunId))
    fail('VERIFY_FAILED', 'the build run URL differs from its ID');
  if (run.status !== 'completed' && run.id !== currentRunId)
    fail('VERIFY_FAILED', 'the build run has not finished');
  const name = `fixed-guest-${buildRunId}`;
  const artifacts = (await api.runArtifacts(buildRunId)).filter(
    (artifact) => artifact.name === name,
  );
  if (artifacts.length !== 1 || artifacts[0]?.expired !== false)
    fail('VERIFY_FAILED', `the build run does not hold the artifact ${name}`);
}

// A release job after the build changes the run's conclusion, so the build
// job's own result is what says the artifact is complete.
export async function checkBuildJob(
  api: GitHubApi,
  buildRunId: number,
  tool: string,
): Promise<void> {
  const jobs = (await api.runJobs(buildRunId)).filter(
    (job) => job.name === `build ${tool}`,
  );
  if (
    jobs.length !== 1 ||
    jobs[0]?.status !== 'completed' ||
    jobs[0]?.conclusion !== 'success'
  )
    fail('VERIFY_FAILED', `the build run's build ${tool} job did not succeed`);
}

function field(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value))
    fail('INVALID_INPUT', `receipt ${label} is malformed`);
  return value;
}

export function parseReceipt(bytes: Uint8Array): BuildReceiptView {
  const raw = parseUniqueJson(bytes, MAX_METADATA_BYTES, 'receipt');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    fail('INVALID_INPUT', 'receipt must be an object');
  const receipt = raw as Record<string, unknown>;
  if (receipt.schemaVersion !== 1)
    fail('INVALID_INPUT', 'receipt schemaVersion must be 1');
  if (typeof receipt.compiled !== 'boolean')
    fail('INVALID_INPUT', 'receipt compiled must be a boolean');
  const source = receipt.source as Record<string, unknown> | null | undefined;
  if (typeof source !== 'object' || source === null)
    fail('INVALID_INPUT', 'receipt needs a source');
  if (typeof source.repository !== 'string' || typeof receipt.tag !== 'string')
    fail('INVALID_INPUT', 'receipt needs a repository and a tag');
  if (typeof receipt.ciRunUrl !== 'string')
    fail('INVALID_INPUT', 'receipt needs its run URL');
  return {
    buildKey: field(receipt.buildKey, SHA256, 'buildKey'),
    tag: receipt.tag,
    compiled: receipt.compiled,
    elfSha256: field(receipt.elfSha256, SHA256, 'elfSha256'),
    buildInfoSha256: field(receipt.buildInfoSha256, SHA256, 'buildInfoSha256'),
    catalogSha256: field(receipt.catalogSha256, SHA256, 'catalogSha256'),
    source: {
      repository: source.repository,
      commit: field(source.commit, COMMIT, 'commit'),
    },
    ciRunUrl: receipt.ciRunUrl,
  };
}

export function toolFromTag(tag: string, key: string): string {
  const suffix = `-${key}`;
  if (!tag.startsWith('guest-') || !tag.endsWith(suffix))
    fail('VERIFY_FAILED', 'receipt tag does not name the build key');
  const tool = tag.slice('guest-'.length, -suffix.length);
  if (!TOOL.test(tool) || releaseTag(tool, key) !== tag)
    fail('VERIFY_FAILED', 'receipt tag does not name a tool');
  return tool;
}

function toolConfig(toolsConfig: unknown, tool: string) {
  const config = parseToolsConfig(toolsConfig);
  if (!Object.hasOwn(config.tools ?? {}, tool))
    fail('INVALID_INPUT', `tools.json has no tool ${tool}`);
  return config.tools[tool] as (typeof config.tools)[string];
}

async function entries(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).sort();
  } catch {
    fail('INVALID_INPUT', `cannot list ${directory}`);
  }
}

async function readCompiledSet(
  root: string,
  key: string,
  binary: string,
): Promise<GuestSet> {
  if (
    (await entries(root)).join('\n') !== [key, RECEIPT_FILE].sort().join('\n')
  )
    fail(
      'VERIFY_FAILED',
      'the artifact holds other files than the set and receipt',
    );
  const directory = join(root, key);
  if ((await entries(directory)).join('\n') !== setAssets(binary).join('\n'))
    fail(
      'VERIFY_FAILED',
      'the artifact set does not hold exactly its five files',
    );
  const read = async (name: string) =>
    new Uint8Array(await readFile(join(directory, name)));
  return {
    elf: await read(binary),
    buildInfo: await read(BUILD_INFO_ASSET),
    catalog: await read(CATALOG_ASSET),
    license: await read(LICENSE_ASSET),
    notices: await read(NOTICES_ASSET),
  };
}

async function readReusedSet(
  root: string,
  identity: SetIdentity,
  fetcher: Fetcher | undefined,
): Promise<GuestSet> {
  if ((await entries(root)).join('\n') !== RECEIPT_FILE)
    fail('VERIFY_FAILED', 'a reuse artifact holds only its receipt');
  const published = await findPublished({
    tool: identity.tool,
    binary: identity.binary,
    key: identity.key,
    source: { repository: identity.repository, commit: identity.commit },
    ...(fetcher === undefined ? {} : { fetcher }),
  });
  if (published === null)
    fail('VERIFY_FAILED', 'the build reused a Release that is not published');
  return published.files;
}

function crossCheck(
  receipt: BuildReceiptView,
  verified: VerifiedGuestSet,
  identity: SetIdentity,
  runUrl: string,
): void {
  if (
    receipt.elfSha256 !== verified.elfSha256 ||
    receipt.buildInfoSha256 !== verified.buildInfoSha256 ||
    receipt.catalogSha256 !== verified.catalogSha256
  )
    fail('VERIFY_FAILED', 'the receipt digests differ from the set');
  const entry = verified.catalog.entries[0];
  if (entry?.url !== assetUrl(RELEASE_REPOSITORY, receipt.tag, identity.binary))
    fail('VERIFY_FAILED', 'the catalog points at another Release file');
  const reference = verified.buildInfo.reference as
    | { ciRunUrl?: unknown }
    | undefined;
  if (receipt.compiled && reference?.ciRunUrl !== runUrl)
    fail('VERIFY_FAILED', 'build-info was recorded by another run');
}

export async function deriveSet(options: {
  api: GitHubApi;
  buildRunId: number;
  currentRunId: number;
  artifactDirectory: string;
  toolsConfig: unknown;
  fetcher?: Fetcher;
}): Promise<PreparedSet> {
  const { api, buildRunId } = options;
  await checkBuildRun(api, buildRunId, options.currentRunId);
  const runUrl = buildRunUrl(buildRunId);
  const receipt = parseReceipt(
    new Uint8Array(
      await readFile(join(options.artifactDirectory, RECEIPT_FILE)).catch(() =>
        fail('VERIFY_FAILED', 'the artifact has no receipt'),
      ),
    ),
  );
  if (receipt.ciRunUrl !== runUrl)
    fail('VERIFY_FAILED', 'the receipt was written by another run');
  const tool = toolFromTag(receipt.tag, receipt.buildKey);
  await checkBuildJob(api, buildRunId, tool);
  const config = toolConfig(options.toolsConfig, tool);
  const identity: SetIdentity = {
    tool,
    binary: config.binary,
    key: receipt.buildKey,
    repository: receipt.source.repository,
    commit: receipt.source.commit,
  };
  const files = receipt.compiled
    ? await readCompiledSet(
        options.artifactDirectory,
        identity.key,
        identity.binary,
      )
    : await readReusedSet(options.artifactDirectory, identity, options.fetcher);
  const verified = verifyGuestSet(files, {
    buildKey: identity.key,
    tool,
    repository: identity.repository,
    commit: identity.commit,
  });
  if (verified.buildInfo.target !== config.target)
    fail('VERIFY_FAILED', 'build-info target differs from tools.json');
  crossCheck(receipt, verified, identity, runUrl);
  return { identity, compiled: receipt.compiled, runUrl, files, verified };
}

export function approvalReference(currentRunId: number): string {
  return `published without approval by run ${buildRunUrl(currentRunId)}`;
}

export function preparePlan(
  prepared: PreparedSet,
  buildRunId: number,
  currentRunId: number,
): { plan: ExternalOperation; bytes: Uint8Array; sha256: string } {
  return makePublishPlan({
    identity: prepared.identity,
    verified: prepared.verified,
    buildRunId,
    rollbackPlan: ROLLBACK_PLAN,
    approvalReference: approvalReference(currentRunId),
  });
}

export function renderSummary(
  prepared: PreparedSet,
  plan: { bytes: Uint8Array; sha256: string },
): string {
  const { identity, verified } = prepared;
  return [
    '### fixed-guest-release plan',
    '',
    'The publish job writes the Release only if its plan SHA256 is this one.',
    '',
    '| Item | Value |',
    '|---|---|',
    `| Build run | ${prepared.runUrl} |`,
    `| Tool / binary | \`${identity.tool}\` / \`${identity.binary}\` |`,
    `| Source | ${identity.repository} @ \`${identity.commit}\` |`,
    `| Build key | \`${identity.key}\` |`,
    `| Tag | \`${releaseTag(identity.tool, identity.key)}\` |`,
    `| Compiled in this run | ${prepared.compiled ? 'yes' : 'no (reused Release)'} |`,
    `| ELF SHA256 | \`${verified.elfSha256}\` |`,
    `| build-info SHA256 | \`${verified.buildInfoSha256}\` |`,
    `| catalog SHA256 | \`${verified.catalogSha256}\` |`,
    `| LICENSE SHA256 | \`${verified.licenseSha256}\` |`,
    `| THIRD_PARTY_NOTICES.md SHA256 | \`${verified.noticesSha256}\` |`,
    `| Plan SHA256 | \`${plan.sha256}\` |`,
    '',
    '```json',
    new TextDecoder().decode(plan.bytes),
    '```',
    '',
  ].join('\n');
}
