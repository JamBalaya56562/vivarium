// Only a run that is already doing work counts. With `countsJob`, a run
// counts only while one of its matching jobs is in progress, so a build run
// that has moved on to its release stage does not hold back the next build.
import { fail } from './errors.ts';
import type { GitHubApi, RunJob } from './github.ts';

export const isBuildJob = (job: RunJob): boolean =>
  job.name.startsWith('build ');

export async function checkNotBusy(
  api: GitHubApi,
  workflowFile: string,
  currentRunId: number,
  countsJob?: (job: RunJob) => boolean,
): Promise<void> {
  if (!Number.isSafeInteger(currentRunId) || currentRunId <= 0)
    fail('INVALID_INPUT', 'current run id is required');
  const others = (await api.activeRuns(workflowFile)).filter(
    (run) => run.id !== currentRunId && run.status === 'in_progress',
  );
  const busy: number[] = [];
  for (const run of others)
    if (
      countsJob === undefined ||
      (await api.runJobs(run.id)).some(
        (job) => job.status === 'in_progress' && countsJob(job),
      )
    )
      busy.push(run.id);
  if (busy.length > 0)
    fail(
      'BUSY',
      `another run of ${workflowFile} is in progress (${busy.join(', ')}); start again after it ends`,
    );
}
