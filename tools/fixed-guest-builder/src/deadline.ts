import { BuildError, fail } from './errors.ts';

export const BUILD_DEADLINE_MS = 14_400_000;

export interface DeadlineOptions {
  deadlineMs: number;
  signal?: AbortSignal;
  cleanup?: () => Promise<void>;
}

// The task must stop its process groups when the signal aborts; the cause is
// reported only after the task has settled and cleanup has finished.
export async function withDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: DeadlineOptions,
): Promise<T> {
  if (!Number.isSafeInteger(options.deadlineMs) || options.deadlineMs <= 0)
    fail('INVALID_INPUT', 'deadlineMs must be positive');
  const controller = new AbortController();
  let cause: 'TIMEOUT' | 'ABORTED' | undefined;
  const timer = setTimeout(() => {
    cause ??= 'TIMEOUT';
    controller.abort();
  }, options.deadlineMs);
  const onParentAbort = () => {
    cause ??= 'ABORTED';
    controller.abort();
  };
  options.signal?.addEventListener('abort', onParentAbort, { once: true });
  if (options.signal?.aborted) onParentAbort();
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await task(controller.signal) };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
  if (options.cleanup !== undefined && (cause !== undefined || !outcome.ok))
    await options.cleanup();
  if (cause === 'TIMEOUT')
    throw new BuildError(
      'TIMEOUT',
      `build exceeded the deadline of ${options.deadlineMs} ms`,
    );
  if (cause === 'ABORTED')
    throw new BuildError('ABORTED', 'build was cancelled');
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
