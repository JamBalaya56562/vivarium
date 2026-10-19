// Only a run that is already doing work counts: the concurrency group keeps
// the others waiting, and one may be waiting for an environment approval.
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
    (run) => run.id !== currentRunId && run.status === 'in_progress',
  );
  if (others.length > 0)
    fail(
      'BUSY',
      `another run of ${workflowFile} is in progress (${others.map((run) => run.id).join(', ')}); start again after it ends`,
    );
}
