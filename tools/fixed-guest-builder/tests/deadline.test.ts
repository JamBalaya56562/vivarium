import { describe, expect, test } from 'bun:test';
import { withDeadline } from '../src/deadline.ts';
import { BuildError } from '../src/errors.ts';
import { runProcess } from '../src/process.ts';

async function errorCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

describe('withDeadline', () => {
  test("returns the task's value and skips cleanup on success", async () => {
    let cleaned = false;
    const value = await withDeadline(async () => 42, {
      deadlineMs: 1000,
      cleanup: async () => {
        cleaned = true;
      },
    });
    expect(value).toBe(42);
    expect(cleaned).toBe(false);
  });

  test('stops the process group at the deadline, then cleans up, then reports TIMEOUT', async () => {
    const order: string[] = [];
    const started = Date.now();
    const run = withDeadline(
      async (signal) => {
        const result = await runProcess('sh', ['-c', 'sleep 30'], {
          signal,
          killGraceMs: 100,
        });
        order.push(`task exited ${result.code}`);
        return result;
      },
      {
        deadlineMs: 50,
        cleanup: async () => {
          order.push('cleanup');
        },
      },
    );
    expect(await errorCode(run)).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(order[0]).toStartWith('task exited');
    expect(order[1]).toBe('cleanup');
  });

  test('reports ABORTED when the parent cancels', async () => {
    const parent = new AbortController();
    let cleaned = false;
    const run = withDeadline(
      (signal) =>
        runProcess('sh', ['-c', 'sleep 30'], { signal, killGraceMs: 100 }),
      {
        deadlineMs: 10_000,
        signal: parent.signal,
        cleanup: async () => {
          cleaned = true;
        },
      },
    );
    setTimeout(() => parent.abort(), 30);
    expect(await errorCode(run)).toBe('ABORTED');
    expect(cleaned).toBe(true);
  });

  test('reports ABORTED without starting work when the parent is already cancelled', async () => {
    const parent = new AbortController();
    parent.abort();
    let sawAborted = false;
    const run = withDeadline(
      async (signal) => {
        sawAborted = signal.aborted;
      },
      { deadlineMs: 1000, signal: parent.signal },
    );
    expect(await errorCode(run)).toBe('ABORTED');
    expect(sawAborted).toBe(true);
  });

  test("cleans up and rethrows the task's own error", async () => {
    let cleaned = false;
    const run = withDeadline(
      async () => {
        throw new BuildError('VERIFY_FAILED', 'bad digest');
      },
      {
        deadlineMs: 1000,
        cleanup: async () => {
          cleaned = true;
        },
      },
    );
    expect(await errorCode(run)).toBe('VERIFY_FAILED');
    expect(cleaned).toBe(true);
  });

  test('refuses a non-positive deadline', async () => {
    expect(
      await errorCode(withDeadline(async () => 1, { deadlineMs: 0 })),
    ).toBe('INVALID_INPUT');
  });

  test('keeps the original cause when cleanup also fails', async () => {
    const run = withDeadline(
      async () => {
        throw new BuildError('EXTERNAL', 'build failed with exit code 1');
      },
      {
        deadlineMs: 1000,
        cleanup: async () => {
          throw new Error('EACCES: permission denied');
        },
      },
    );
    const error = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe('EXTERNAL');
    expect((error as BuildError).message).toContain(
      'build failed with exit code 1',
    );
    expect((error as BuildError).message).toContain(
      'cleanup also failed: EACCES',
    );
  });

  test('keeps TIMEOUT as the cause when cleanup after it fails', async () => {
    const run = withDeadline(
      (signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve()),
        ),
      {
        deadlineMs: 20,
        cleanup: async () => {
          throw new Error('EACCES');
        },
      },
    );
    const error = (await run.catch((caught: unknown) => caught)) as BuildError;
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toContain('cleanup also failed');
  });
});
