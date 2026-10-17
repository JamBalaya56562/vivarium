import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BuildError } from '../src/errors.ts';
import { directoryBytes, runMonitored } from '../src/monitor.ts';
import { tempDir } from './helpers/git.ts';

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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('directoryBytes', () => {
  test('sums regular files, skips symlinks and treats missing paths as empty', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'a/b'), { recursive: true });
    await writeFile(join(root, 'a/one'), 'x'.repeat(10));
    await writeFile(join(root, 'a/b/two'), 'y'.repeat(5));
    await symlink(join(root, 'a/one'), join(root, 'a/link'));
    expect(await directoryBytes([join(root, 'a'), join(root, 'missing')])).toBe(
      15,
    );
  });
});

describe('runMonitored', () => {
  test('accepts a fetch that ends exactly at the limit and records the size', async () => {
    const root = await tempDir();
    const result = await runMonitored(
      'sh',
      ['-c', 'head -c 4096 /dev/zero > out'],
      {
        cwd: root,
        watch: [root],
        limitBytes: 4096,
        intervalMs: 10,
      },
    );
    expect(result.code).toBe(0);
    expect(result.bytes).toBe(4096);
  });

  test('refuses a fetch that ends one byte above the limit', async () => {
    const root = await tempDir();
    const run = runMonitored('sh', ['-c', 'head -c 4097 /dev/zero > out'], {
      cwd: root,
      watch: [root],
      limitBytes: 4096,
      intervalMs: 10,
    });
    expect(await errorCode(run)).toBe('LIMIT_EXCEEDED');
  });

  test('stops a fetch that keeps writing, including its background children', async () => {
    const root = await tempDir();
    const script =
      '(while true; do head -c 1024 /dev/zero >> grow; sleep 0.01; done) & echo $! > child; wait';
    const started = Date.now();
    const run = runMonitored('sh', ['-c', script], {
      cwd: root,
      watch: [join(root, 'grow')],
      limitBytes: 8 * 1024,
      intervalMs: 20,
      killGraceMs: 200,
    });
    expect(await errorCode(run)).toBe('LIMIT_EXCEEDED');
    expect(Date.now() - started).toBeLessThan(5000);
    const child = Number((await readFile(join(root, 'child'), 'utf8')).trim());
    await Bun.sleep(50);
    expect(alive(child)).toBe(false);
  });

  test('uses an injected measure and refuses an invalid limit', async () => {
    let calls = 0;
    const result = await runMonitored('sh', ['-c', 'sleep 0.1'], {
      watch: ['unused'],
      limitBytes: 10,
      intervalMs: 10,
      measure: async () => {
        calls += 1;
        return 3;
      },
    });
    expect(result.bytes).toBe(3);
    expect(calls).toBeGreaterThan(1);
    expect(
      await errorCode(runMonitored('true', [], { watch: [], limitBytes: -1 })),
    ).toBe('INVALID_INPUT');
  });

  test("returns the command's own failure without calling it a size problem", async () => {
    const root = await tempDir();
    const result = await runMonitored('sh', ['-c', 'echo nope >&2; exit 3'], {
      cwd: root,
      watch: [root],
      limitBytes: 100,
      intervalMs: 10,
    });
    expect(result.code).toBe(3);
    expect(result.stderr).toBe('nope\n');
  });
});

test('directoryBytes counts an unreadable directory as empty instead of failing', async () => {
  const root = await tempDir();
  const locked = join(root, 'locked');
  await mkdir(locked);
  await writeFile(join(locked, 'x'), 'xyz');
  await chmod(locked, 0o000);
  try {
    expect(await directoryBytes([locked])).toBe(0);
  } finally {
    await chmod(locked, 0o755);
  }
});
