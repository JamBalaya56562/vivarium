// Releases take turns here, not in a concurrency group: a group keeps one
// pending run and cancels the one before it, and a release called from a
// build belongs to the build's run. A publish job is in line once its turn
// step has started and ahead once that step has finished.
import { fail } from './errors.ts';
import type { GitHubApi, RunJob } from './github.ts';

export const PUBLISH_TURN_STEP = 'Wait for the publish turn';
export const PUBLISH_WORKFLOWS = [
  'fixed-guest-release.yml',
  'fixed-guest-build.yml',
] as const;

export interface TurnTiming {
  waitMs: number;
  firstDelayMs: number;
  maxDelayMs: number;
  // A step's status reaches the API a little late, so a free turn is taken
  // only when a second look after this pause agrees.
  settleMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

// The publish job has 30 minutes; a publish itself takes under a minute.
export const PUBLISH_TURN_TIMING: TurnTiming = {
  waitMs: 20 * 60_000,
  firstDelayMs: 5_000,
  maxDelayMs: 60_000,
  settleMs: 10_000,
  now: Date.now,
  sleep: (ms) => Bun.sleep(ms),
};

function isAhead(job: RunJob, runId: number, currentRunId: number): boolean {
  if (job.status !== 'in_progress') return false;
  const turn = job.steps.find((step) => step.name === PUBLISH_TURN_STEP);
  if (turn === undefined) return false;
  if (turn.status === 'completed') return turn.conclusion === 'success';
  // Both still waiting: the smaller run ID goes first.
  return runId < currentRunId;
}

async function runsAhead(
  api: GitHubApi,
  currentRunId: number,
): Promise<number[]> {
  const ids = new Set<number>();
  for (const workflow of PUBLISH_WORKFLOWS)
    for (const run of await api.activeRuns(workflow))
      if (run.status === 'in_progress' && run.id !== currentRunId)
        ids.add(run.id);
  const ahead: number[] = [];
  for (const id of [...ids].sort((a, b) => a - b))
    if ((await api.runJobs(id)).some((job) => isAhead(job, id, currentRunId)))
      ahead.push(id);
  return ahead;
}

export async function waitForPublishTurn(
  api: GitHubApi,
  currentRunId: number,
  timing: TurnTiming = PUBLISH_TURN_TIMING,
): Promise<{ waitedMs: number }> {
  if (!Number.isSafeInteger(currentRunId) || currentRunId <= 0)
    fail('INVALID_INPUT', 'current run id is required');
  const start = timing.now();
  let delay = timing.firstDelayMs;
  let settled = false;
  for (;;) {
    const ahead = await runsAhead(api, currentRunId);
    if (ahead.length === 0) {
      if (settled) return { waitedMs: timing.now() - start };
      settled = true;
      await timing.sleep(timing.settleMs);
      continue;
    }
    settled = false;
    const waited = timing.now() - start;
    if (waited + delay > timing.waitMs)
      fail(
        'BUSY',
        `the publish of run ${ahead.join(', ')} is still ahead after ${Math.round(waited / 1000)} s; nothing was written. Start fixed-guest-release again with the build run ID once it ends`,
      );
    await timing.sleep(delay);
    delay = Math.min(delay * 2, timing.maxDelayMs);
  }
}
