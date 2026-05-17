// Internal helper for `verify_and_report_fix` on Layer 1 recipes.
// Drives the existing Playwright harness via a targeted `--grep
// "verdict-capture: <slug>"` invocation, reads back the verdict JSON
// the spec writes to `VERDICT_CAPTURE_OUTPUT`. Not exposed as an MCP
// tool: callers go through `verify_and_report_fix` for the layer-
// abstracted entrypoint.
//
// Phase 3 of the round-trip automation plan. Replaces the Phase 1
// "return commands as strings" Layer 1 path with real execution.

import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Verdict } from '../types.js';

export interface RunLayer1VerdictArgs {
  slug: string;
  fix_url?: string;
  // Path to the Layer 1 workspace (the directory containing
  // `playwright.config.ts`). Defaults to the relative path the
  // monorepo uses today; pass an absolute path when the MCP server
  // is launched from a different working directory.
  workspace_path?: string;
}

export interface RunLayer1VerdictOk {
  ok: true;
  slug: string;
  verdict: Verdict;
  captured_at: string;
  duration_ms: number;
  fix_url: string | null;
}

export interface RunLayer1VerdictError {
  ok: false;
  error: string;
  stderr_tail?: string;
  duration_ms: number;
}

export type RunLayer1VerdictResult =
  | RunLayer1VerdictOk
  | RunLayer1VerdictError;

// Injectable for unit tests. Returns { status, stdout, stderr } so the
// real impl and any stub agree on the contract.
export interface SpawnRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnRunner = (input: {
  cwd: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}) => SpawnRunResult;

const defaultSpawnRunner: SpawnRunner = ({ cwd, command, args, env }) => {
  const r = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf-8',
    // Playwright + Pyodide cold-start can sit in the 60-90 second range
    // per case; the spec's own timeout is 75s. Hard-cap the spawn at
    // 5 minutes so a hung Playwright child cannot wedge the MCP server.
    timeout: 5 * 60 * 1000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
};

let spawnRunner: SpawnRunner = defaultSpawnRunner;

export function _setSpawnRunnerForTesting(runner: SpawnRunner | null): void {
  spawnRunner = runner ?? defaultSpawnRunner;
}

// Injectable for unit tests; the real impl reads the file the
// Playwright spec wrote at `VERDICT_CAPTURE_OUTPUT`.
export type VerdictReader = (outputPath: string) => string;

const defaultVerdictReader: VerdictReader = (p) => readFileSync(p, 'utf-8');

let verdictReader: VerdictReader = defaultVerdictReader;

export function _setVerdictReaderForTesting(
  reader: VerdictReader | null,
): void {
  verdictReader = reader ?? defaultVerdictReader;
}

const DEFAULT_WORKSPACE_PATH = 'src/layer1_wasm';

interface CapturedVerdict {
  slug: string;
  verdict: Verdict;
  fix_url: string | null;
  captured_at: string;
}

function isVerdict(value: unknown): value is Verdict {
  return value === 'reproduced' || value === 'unreproduced';
}

export async function runLayer1Verdict(
  args: RunLayer1VerdictArgs,
): Promise<RunLayer1VerdictResult> {
  const slug = args.slug?.trim();
  if (!slug) {
    return { ok: false, error: 'missing required argument: slug', duration_ms: 0 };
  }

  const workspacePath = args.workspace_path ?? DEFAULT_WORKSPACE_PATH;
  const outputPath = join(
    tmpdir(),
    `vivarium-verdict-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VERDICT_CAPTURE_OUTPUT: outputPath,
  };
  if (args.fix_url) env['PLAYWRIGHT_FIX_URL'] = args.fix_url;

  const startedAt = Date.now();
  const spawn = spawnRunner({
    cwd: workspacePath,
    command: 'bun',
    args: ['run', 'test', '--grep', `verdict-capture: ${slug}`],
    env,
  });
  const durationMs = Date.now() - startedAt;

  if (spawn.status !== 0) {
    // Best-effort cleanup of the tmp output if it exists.
    try {
      unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: `playwright exited with status ${spawn.status}`,
      stderr_tail: spawn.stderr.slice(-2000),
      duration_ms: durationMs,
    };
  }

  let raw: string;
  try {
    raw = verdictReader(outputPath);
  } catch (err) {
    return {
      ok: false,
      error: `failed to read verdict output (${outputPath}): ${err instanceof Error ? err.message : String(err)}`,
      stderr_tail: spawn.stderr.slice(-2000),
      duration_ms: durationMs,
    };
  }

  let parsed: CapturedVerdict;
  try {
    parsed = JSON.parse(raw) as CapturedVerdict;
  } catch (err) {
    return {
      ok: false,
      error: `verdict output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      duration_ms: durationMs,
    };
  }

  if (parsed.slug !== slug) {
    return {
      ok: false,
      error: `verdict output slug "${parsed.slug}" does not match requested "${slug}"`,
      duration_ms: durationMs,
    };
  }
  if (!isVerdict(parsed.verdict)) {
    return {
      ok: false,
      error: `verdict output contains unexpected verdict value "${parsed.verdict}"`,
      duration_ms: durationMs,
    };
  }

  // Real impl cleans up the tmp file; injected reader (tests) skip.
  if (verdictReader === defaultVerdictReader) {
    try {
      unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    slug,
    verdict: parsed.verdict,
    captured_at: parsed.captured_at ?? new Date().toISOString(),
    duration_ms: durationMs,
    fix_url: parsed.fix_url ?? null,
  };
}
