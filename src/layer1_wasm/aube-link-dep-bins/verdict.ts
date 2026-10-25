import type { VivariumResultV1 } from '../_shared/verdict.js';

export type GuestRole = 'baseline' | 'fix';

export const BUILDER_NODE_MODULES =
  'node_modules/.aube/builder@file+f207b01d788bfbae/node_modules';

export const COMMANDS = [
  'cat vendor/builder/package.json',
  'aube install',
  `ls ${BUILDER_NODE_MODULES}`,
] as const;

export const BIN_COMMAND = `ls ${BUILDER_NODE_MODULES}/.bin`;

export interface CommandResult {
  command: string;
  code: number;
  output: string;
}

export interface CommandRunner {
  run(command: string): Promise<CommandResult>;
}

export interface FixtureText {
  builderManifest: string;
}

export interface SessionResult {
  role: GuestRole;
  commands: CommandResult[];
  listing: string[];
  hasBinDirectory: boolean;
  bins: string[];
  reproduced: boolean;
  corrected: boolean;
}

export type Outcome =
  | { ok: true; session: SessionResult }
  | { ok: false; error: string };

export interface Decision {
  verdict: 'reproduced' | 'unreproduced';
  fixStatus: 'ok' | 'error';
  baselineError: string | null;
  fixError: string | null;
  baselineCorrected: boolean;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g');

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function normalizeOutput(text: string): string {
  return stripAnsi(text).replace(/\r\n/g, '\n').trimEnd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseListing(output: string): string[] {
  return normalizeOutput(output)
    .split('\n')
    .filter((line) => line !== '');
}

export function readListing(listing: readonly string[]): boolean {
  if (!listing.includes('builder/'))
    throw new SessionError('builder is not in its own node_modules');
  if (!listing.some((line) => line.startsWith('linked-tool -> ')))
    throw new SessionError('linked-tool is not linked beside builder');
  return listing.includes('.bin/');
}

export async function runSession(
  role: GuestRole,
  runner: CommandRunner,
  fixture: FixtureText,
): Promise<SessionResult> {
  const commands: CommandResult[] = [];
  const run = async (command: string): Promise<string> => {
    const result = await runner.run(command);
    commands.push(result);
    if (result.code !== 0)
      throw new SessionError(`${role}: ${command} exited ${result.code}`);
    return result.output;
  };
  const [catManifest, install, list] = COMMANDS;
  if (
    normalizeOutput(await run(catManifest)) !==
    normalizeOutput(fixture.builderManifest)
  )
    throw new SessionError(
      `${role}: vendor/builder/package.json differs from the fixture`,
    );
  await run(install);
  const listing = parseListing(await run(list));
  let hasBinDirectory: boolean;
  try {
    hasBinDirectory = readListing(listing);
  } catch (error) {
    throw new SessionError(
      `${role}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const bins = hasBinDirectory ? parseListing(await run(BIN_COMMAND)) : [];
  const linked = bins.includes('linked-tool');
  return {
    role,
    commands,
    listing,
    hasBinDirectory,
    bins,
    reproduced: !linked,
    corrected: linked,
  };
}

export async function settle(
  session: Promise<SessionResult>,
): Promise<Outcome> {
  try {
    return { ok: true, session: await session };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function decide(baseline: Outcome, fix: Outcome): Decision {
  const fixError = fix.ok
    ? fix.session.corrected
      ? null
      : "fix: builder's .bin has no linked-tool"
    : fix.error;
  return {
    verdict:
      baseline.ok && baseline.session.reproduced
        ? 'reproduced'
        : 'unreproduced',
    fixStatus: fixError === null ? 'ok' : 'error',
    baselineError: baseline.ok ? null : baseline.error,
    fixError,
    baselineCorrected: baseline.ok && baseline.session.corrected,
  };
}

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function canonicalString(value: string): string {
  if (LONE_SURROGATE.test(value))
    throw new TypeError('canonical JSON refuses a lone surrogate');
  return JSON.stringify(value);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'string') return canonicalString(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new TypeError('canonical JSON takes safe integers only');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${canonicalString(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON takes JSON values only');
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function fixtureSha256(
  files: readonly { path: string; bytes: Uint8Array }[],
): Promise<string> {
  const entries = await Promise.all(
    files.map(async ({ path, bytes }) => ({
      path,
      sha256: await sha256Hex(bytes),
    })),
  );
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 1; i < entries.length; i += 1)
    if (entries[i]?.path === entries[i - 1]?.path)
      throw new TypeError(`fixture repeats ${entries[i]?.path}`);
  return sha256Hex(canonicalJson(entries));
}

export async function commandSha256(
  commands: readonly string[],
): Promise<string> {
  return sha256Hex(canonicalJson([...commands]));
}

export interface GuestIdentity {
  commit: string;
  buildKey: string;
}

export interface EnvelopeInput {
  decision: Decision;
  baseline: SessionResult | null;
  fix: SessionResult | null;
  upstreamUrl: string;
  packageVersion: string;
  packSha256: string;
  fixtureSha256: string;
  guests: Record<GuestRole, GuestIdentity>;
  startedAt: Date;
  finishedAt: Date;
}

export function buildEnvelope(input: EnvelopeInput): VivariumResultV1 {
  return {
    contract: 'v1',
    bug: { project: 'aube', issue: 0, upstream_url: input.upstreamUrl },
    runtime: {
      name: 'formicarium',
      version: input.packageVersion,
      extras: {
        fixture_sha256: input.fixtureSha256,
        baseline_commit: input.guests.baseline.commit,
        baseline_build_key: input.guests.baseline.buildKey,
        fix_commit: input.guests.fix.commit,
        fix_build_key: input.guests.fix.buildKey,
        pack_sha256: input.packSha256,
      },
    },
    result: {
      baseline: input.baseline,
      fix_candidate: input.fix,
      baseline_error: input.decision.baselineError,
      fix_error: input.decision.fixError,
      baseline_corrected: input.decision.baselineCorrected,
    },
    timing: {
      started_at: input.startedAt.toISOString(),
      finished_at: input.finishedAt.toISOString(),
      duration_ms: input.finishedAt.getTime() - input.startedAt.getTime(),
    },
  };
}
