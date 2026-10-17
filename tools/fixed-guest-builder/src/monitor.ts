import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from './errors.ts';
import { type RunOptions, type RunResult, spawnGroup } from './process.ts';

export const SOURCE_LIMIT_BYTES = 2 * 1024 ** 3;
export const DEPENDENCY_LIMIT_BYTES = 4 * 1024 ** 3;

// A missing path counts as empty: the fetch may not have created it yet.
export async function directoryBytes(
  paths: readonly string[],
): Promise<number> {
  let total = 0;
  const pending = [...paths];
  while (pending.length > 0) {
    const path = pending.pop() as string;
    const info = await lstat(path).catch(() => undefined);
    if (info === undefined) continue;
    if (info.isDirectory()) {
      const entries = await readdir(path).catch(() => [] as string[]);
      for (const entry of entries) pending.push(join(path, entry));
    } else if (info.isFile()) {
      total += info.size;
    }
  }
  return total;
}

export interface MonitoredOptions extends RunOptions {
  watch: readonly string[];
  limitBytes: number;
  intervalMs?: number;
  measure?: (paths: readonly string[]) => Promise<number>;
}

export interface MonitoredResult extends RunResult {
  bytes: number;
  peakBytes: number;
}

// Checked between intervals, so a fetch can overshoot by one interval's writes.
export async function runMonitored(
  command: string,
  args: readonly string[],
  options: MonitoredOptions,
): Promise<MonitoredResult> {
  if (!Number.isSafeInteger(options.limitBytes) || options.limitBytes < 0)
    fail('INVALID_INPUT', 'limitBytes must be a safe integer');
  const measure = options.measure ?? directoryBytes;
  const group = spawnGroup(command, args, options);
  let peak = 0;
  let exceeded = false;
  let running = true;
  const watcher = (async () => {
    while (running) {
      await Bun.sleep(options.intervalMs ?? 2000);
      if (!running) break;
      const bytes = await measure(options.watch);
      peak = Math.max(peak, bytes);
      if (bytes > options.limitBytes) {
        exceeded = true;
        await group.stop();
        break;
      }
    }
  })();
  const result = await group.result;
  running = false;
  await watcher;
  const bytes = await measure(options.watch);
  peak = Math.max(peak, bytes);
  if (exceeded || bytes > options.limitBytes)
    fail(
      'LIMIT_EXCEEDED',
      `fetch wrote ${bytes} bytes, above the limit of ${options.limitBytes}`,
    );
  return { ...result, bytes, peakBytes: peak };
}
