// Refuses instead of queueing: GitHub keeps one pending run per group and
// cancels it when a newer one arrives.
import { fail } from './errors.ts';
import type { GitHubApi } from './github.ts';

export async function checkNotBusy(
  api: GitHubApi,
  workflowFile: string,
  currentRunId: number,
): Promise<void> {
  if (!Number.isSafeInteger(currentRunId) || currentRunId <= 0)
    fail('INVALID_INPUT', 'current run id is required');
  const others = (await api.activeRuns(workflowFile)).filter(
    (run) => run.id !== currentRunId,
  );
  if (others.length > 0)
    fail(
      'BUSY',
      `another run of ${workflowFile} is active (${others.map((run) => `${run.id}:${run.status}`).join(', ')}); start again after it ends`,
    );
}
