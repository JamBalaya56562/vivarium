import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetchVerdictSnapshot, getCatalogue } from '../catalogue.js';
import type { Verdict, VerdictSnapshot } from '../types.js';

export interface RunLayer23VerdictArgs {
  slug: string;
  mode: 'unfixed' | 'fixed';
  branch_image?: string;
  expected_verdict?: Verdict;
  poll_interval_ms?: number;
  poll_timeout_ms?: number;
  repo?: string;
}

export interface RunLayer23VerdictOk {
  ok: true;
  slug: string;
  mode: 'unfixed' | 'fixed';
  verdict: Verdict;
  captured_at: string;
  duration_ms: number;
  source: 'deployed-snapshot' | 'workflow-artefact';
  workflow_run_id?: number;
}

export interface RunLayer23VerdictError {
  ok: false;
  error: string;
  duration_ms: number;
  workflow_run_id?: number;
}

export type RunLayer23VerdictResult =
  | RunLayer23VerdictOk
  | RunLayer23VerdictError;

export interface GhRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[]) => GhRunResult;

const defaultGhRunner: GhRunner = (args) => {
  const r = spawnSync('gh', args, {
    encoding: 'utf-8',
    timeout: 5 * 60 * 1000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
};

let ghRunner: GhRunner = defaultGhRunner;

export function _setGhRunnerForTesting(runner: GhRunner | null): void {
  ghRunner = runner ?? defaultGhRunner;
}

export type SnapshotFetcher = (slug: string) => Promise<VerdictSnapshot | null>;

const defaultSnapshotFetcher: SnapshotFetcher = async (slug) => {
  const { recipes } = await getCatalogue();
  const recipe = recipes.find((r) => r.slug === slug);
  if (!recipe || !recipe.verdict_url) return null;
  return fetchVerdictSnapshot(recipe.verdict_url);
};

let snapshotFetcher: SnapshotFetcher = defaultSnapshotFetcher;

export function _setSnapshotFetcherForTesting(
  fetcher: SnapshotFetcher | null,
): void {
  snapshotFetcher = fetcher ?? defaultSnapshotFetcher;
}

export type Sleeper = (ms: number) => Promise<void>;

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let sleeper: Sleeper = defaultSleeper;

export function _setSleeperForTesting(s: Sleeper | null): void {
  sleeper = s ?? defaultSleeper;
}

const DEFAULT_REPO = 'aletheia-works/vivarium';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const POST_DISPATCH_WAIT_MS = 3_000;

function isVerdict(value: unknown): value is Verdict {
  return value === 'reproduced' || value === 'unreproduced';
}

export async function runLayer23Verdict(
  args: RunLayer23VerdictArgs,
): Promise<RunLayer23VerdictResult> {
  const slug = args.slug?.trim();
  if (!slug) {
    return { ok: false, error: 'missing required argument: slug', duration_ms: 0 };
  }
  if (args.mode !== 'unfixed' && args.mode !== 'fixed') {
    return {
      ok: false,
      error: `invalid mode "${args.mode}" (must be 'unfixed' or 'fixed')`,
      duration_ms: 0,
    };
  }

  const startedAt = Date.now();

  if (args.mode === 'unfixed') {
    let snapshot: VerdictSnapshot | null;
    try {
      snapshot = await snapshotFetcher(slug);
    } catch (err) {
      return {
        ok: false,
        error: `snapshot fetch threw: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - startedAt,
      };
    }
    if (!snapshot) {
      return {
        ok: false,
        error: `no deployed verdict snapshot for slug "${slug}" (Layer 1 recipes have no static verdict.json — use Layer 1 path instead)`,
        duration_ms: Date.now() - startedAt,
      };
    }
    return {
      ok: true,
      slug,
      mode: 'unfixed',
      verdict: snapshot.verdict,
      captured_at: snapshot.captured_at,
      duration_ms: Date.now() - startedAt,
      source: 'deployed-snapshot',
    };
  }

  if (!args.branch_image?.trim()) {
    return {
      ok: false,
      error: 'branch_image is required when mode=fixed',
      duration_ms: 0,
    };
  }
  const branchImage = args.branch_image.trim();
  const expectedVerdict = args.expected_verdict ?? 'unreproduced';
  if (!isVerdict(expectedVerdict)) {
    return {
      ok: false,
      error: `expected_verdict must be 'reproduced' or 'unreproduced', got "${expectedVerdict}"`,
      duration_ms: 0,
    };
  }

  const repo = args.repo ?? DEFAULT_REPO;
  const pollInterval = args.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeout = args.poll_timeout_ms ?? DEFAULT_POLL_TIMEOUT_MS;

  const dispatchBoundary = Date.now();

  const dispatch = ghRunner([
    'workflow',
    'run',
    'branch-fix-verdict.yml',
    '--repo',
    repo,
    '-f',
    `slug=${slug}`,
    '-f',
    `branch_image=${branchImage}`,
    '-f',
    `expected_verdict=${expectedVerdict}`,
  ]);
  if (dispatch.status !== 0) {
    return {
      ok: false,
      error: `gh workflow run failed: ${dispatch.stderr.trim() || '<no stderr>'}`,
      duration_ms: Date.now() - startedAt,
    };
  }

  await sleeper(POST_DISPATCH_WAIT_MS);
  const list = ghRunner([
    'run',
    'list',
    '--repo',
    repo,
    '--workflow=branch-fix-verdict.yml',
    '--event=workflow_dispatch',
    '--limit',
    '10',
    '--json',
    'databaseId,status,createdAt',
  ]);
  if (list.status !== 0) {
    return {
      ok: false,
      error: `gh run list failed: ${list.stderr.trim() || '<no stderr>'}`,
      duration_ms: Date.now() - startedAt,
    };
  }
  let runs: Array<{ databaseId: number; status: string; createdAt: string }>;
  try {
    runs = JSON.parse(list.stdout);
  } catch (err) {
    return {
      ok: false,
      error: `failed to parse gh run list output: ${err instanceof Error ? err.message : String(err)}`,
      duration_ms: Date.now() - startedAt,
    };
  }
  if (!Array.isArray(runs) || runs.length === 0) {
    return {
      ok: false,
      error: 'no workflow run found after dispatch',
      duration_ms: Date.now() - startedAt,
    };
  }
  const CLOCK_BUFFER_MS = 5_000;
  const cutoff = dispatchBoundary - CLOCK_BUFFER_MS;
  const candidates = runs
    .map((r) => ({
      databaseId: r.databaseId,
      status: r.status,
      createdAtMs: new Date(r.createdAt).getTime(),
    }))
    .filter((r) => !Number.isNaN(r.createdAtMs) && r.createdAtMs >= cutoff);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: `no workflow run created at or after dispatch (cutoff: ${new Date(cutoff).toISOString()}, ${runs.length} older run(s) ignored)`,
      duration_ms: Date.now() - startedAt,
    };
  }
  candidates.sort((a, b) => a.createdAtMs - b.createdAtMs);
  const runId = candidates[0]!.databaseId;

  const pollDeadline = startedAt + pollTimeout;
  let conclusion: string | null = null;
  while (Date.now() < pollDeadline) {
    const view = ghRunner([
      'run',
      'view',
      String(runId),
      '--repo',
      repo,
      '--json',
      'status,conclusion',
    ]);
    if (view.status !== 0) {
      return {
        ok: false,
        error: `gh run view failed: ${view.stderr.trim() || '<no stderr>'}`,
        duration_ms: Date.now() - startedAt,
        workflow_run_id: runId,
      };
    }
    let parsed: { status: string; conclusion: string | null };
    try {
      parsed = JSON.parse(view.stdout);
    } catch (err) {
      return {
        ok: false,
        error: `failed to parse gh run view output: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - startedAt,
        workflow_run_id: runId,
      };
    }
    if (parsed.status === 'completed') {
      conclusion = parsed.conclusion;
      break;
    }
    await sleeper(pollInterval);
  }
  if (conclusion === null) {
    return {
      ok: false,
      error: `workflow run ${runId} did not complete within ${pollTimeout}ms`,
      duration_ms: Date.now() - startedAt,
      workflow_run_id: runId,
    };
  }

  const artefactName = `branch-fix-verdict-${slug}-${runId}`;
  const downloadDir = mkdtempSync(join(tmpdir(), `vivarium-artefact-${slug}-`));

  try {
    const download = ghRunner([
      'run',
      'download',
      String(runId),
      '--repo',
      repo,
      '--name',
      artefactName,
      '--dir',
      downloadDir,
    ]);
    if (download.status !== 0) {
      return {
        ok: false,
        error: `gh run download failed (conclusion=${conclusion}): ${download.stderr.trim() || '<no stderr>'}`,
        duration_ms: Date.now() - startedAt,
        workflow_run_id: runId,
      };
    }

    const verdictPath = join(downloadDir, 'branch-fix-verdict.json');
    let raw: string;
    try {
      raw = readFileSync(verdictPath, 'utf-8');
    } catch (err) {
      return {
        ok: false,
        error: `failed to read branch-fix-verdict.json from artefact: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - startedAt,
        workflow_run_id: runId,
      };
    }
    let parsed: VerdictSnapshot;
    try {
      parsed = JSON.parse(raw) as VerdictSnapshot;
    } catch (err) {
      return {
        ok: false,
        error: `branch-fix-verdict.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - startedAt,
        workflow_run_id: runId,
      };
    }
    if (!isVerdict(parsed.verdict)) {
      return {
        ok: false,
        error: `branch-fix verdict has unexpected value "${parsed.verdict}"`,
        duration_ms: Date.now() - startedAt,
        workflow_run_id: runId,
      };
    }

    return {
      ok: true,
      slug,
      mode: 'fixed',
      verdict: parsed.verdict,
      captured_at: parsed.captured_at,
      duration_ms: Date.now() - startedAt,
      source: 'workflow-artefact',
      workflow_run_id: runId,
    };
  } finally {
    try {
      rmSync(downloadDir, { recursive: true, force: true });
    } catch {
    }
  }
}
