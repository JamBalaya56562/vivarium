import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { BuildError } from '../src/errors.ts';
import type { RunJob } from '../src/github.ts';
import {
  PUBLISH_TURN_STEP,
  PUBLISH_TURN_TIMING,
  PUBLISH_WORKFLOWS,
  type TurnTiming,
  waitForPublishTurn,
} from '../src/turn.ts';
import { FakeGitHub } from './helpers/fake-github.ts';

async function errorOf(promise: Promise<unknown>): Promise<BuildError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BuildError) return error;
    throw error;
  }
  throw new Error('expected a BuildError');
}

const CURRENT = 50;

function publishJob(gate: 'queued' | 'in_progress' | 'completed'): RunJob {
  return {
    name: 'publish 0123',
    status: 'in_progress',
    conclusion: null,
    steps: [
      { name: 'Set up job', status: 'completed', conclusion: 'success' },
      {
        name: PUBLISH_TURN_STEP,
        status: gate,
        conclusion: gate === 'completed' ? 'success' : null,
      },
      {
        name: 'Publish under the prepared plan',
        status: 'queued',
        conclusion: null,
      },
    ],
  };
}

// A clock that only moves when the code under test sleeps; `onSleep` lets a
// test change the other runs while this one waits.
function clock(onSleep: (call: number) => void = () => undefined) {
  let time = 0;
  const sleeps: number[] = [];
  const timing: TurnTiming = {
    waitMs: 60_000,
    firstDelayMs: 1_000,
    maxDelayMs: 4_000,
    settleMs: 500,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
      onSleep(sleeps.length);
    },
  };
  return { timing, sleeps };
}

function withRun(api: FakeGitHub, id: number, jobs: RunJob[], workflow = 0) {
  const file = PUBLISH_WORKFLOWS[workflow] as string;
  const runs = api.runsByWorkflow.get(file) ?? [];
  runs.push({ id, status: 'in_progress' });
  api.runsByWorkflow.set(file, runs);
  api.jobs.set(id, jobs);
}

function emptyApi(): FakeGitHub {
  const api = new FakeGitHub();
  for (const file of PUBLISH_WORKFLOWS) api.runsByWorkflow.set(file, []);
  return api;
}

describe('waitForPublishTurn', () => {
  test('goes after one settling check when no other publish is in progress', async () => {
    const api = emptyApi();
    withRun(api, CURRENT, [publishJob('in_progress')]);
    const { timing, sleeps } = clock();
    expect(await waitForPublishTurn(api, CURRENT, timing)).toEqual({
      waitedMs: 500,
    });
    expect(sleeps).toEqual([500]);
  });

  test('waits with a growing, capped delay while an earlier publish writes, then goes', async () => {
    const api = emptyApi();
    withRun(api, 40, [publishJob('completed')]);
    const { timing, sleeps } = clock((call) => {
      if (call === 4) api.jobs.set(40, []);
    });
    await waitForPublishTurn(api, CURRENT, timing);
    expect(sleeps).toEqual([1_000, 2_000, 4_000, 4_000, 500]);
  });

  test('lets the smaller run ID go first when both wait, but waits for a larger one that already writes', async () => {
    const waiting = emptyApi();
    withRun(waiting, 70, [publishJob('in_progress')]);
    expect(
      (await waitForPublishTurn(waiting, CURRENT, clock().timing)).waitedMs,
    ).toBe(500);

    const earlier = emptyApi();
    withRun(earlier, 30, [publishJob('queued')]);
    const first = clock();
    first.timing.waitMs = 3_000;
    expect(
      (await errorOf(waitForPublishTurn(earlier, CURRENT, first.timing))).code,
    ).toBe('BUSY');

    const writing = emptyApi();
    withRun(writing, 70, [publishJob('completed')]);
    const second = clock();
    second.timing.waitMs = 3_000;
    expect(
      (await errorOf(waitForPublishTurn(writing, CURRENT, second.timing))).code,
    ).toBe('BUSY');
  });

  test('counts a publish called from a build run, and ignores jobs that are not publishing', async () => {
    const api = emptyApi();
    withRun(
      api,
      45,
      [
        {
          name: 'build biome',
          status: 'completed',
          conclusion: 'success',
          steps: [],
        },
        { ...publishJob('completed'), name: 'release / publish 0123' },
      ],
      1,
    );
    withRun(api, 46, [
      { name: 'prepare', status: 'in_progress', conclusion: null, steps: [] },
    ]);
    withRun(api, 47, [{ ...publishJob('completed'), status: 'completed' }]);
    const { timing, sleeps } = clock((call) => {
      if (call === 1) api.jobs.set(45, []);
    });
    await waitForPublishTurn(api, CURRENT, timing);
    expect(sleeps).toEqual([1_000, 500]);
  });

  test('checks again after settling and waits for a run that started writing meanwhile', async () => {
    const api = emptyApi();
    withRun(api, 70, [publishJob('in_progress')]);
    const { timing, sleeps } = clock((call) => {
      if (call === 1) api.jobs.set(70, [publishJob('completed')]);
      if (call === 2) api.jobs.set(70, []);
    });
    await waitForPublishTurn(api, CURRENT, timing);
    expect(sleeps).toEqual([500, 1_000, 500]);
  });

  test('fails BUSY with the runs ahead within its bound and never sleeps past it', async () => {
    const api = emptyApi();
    withRun(api, 40, [publishJob('completed')]);
    const { timing, sleeps } = clock();
    timing.waitMs = 10_000;
    const error = await errorOf(waitForPublishTurn(api, CURRENT, timing));
    expect(error.code).toBe('BUSY');
    expect(error.message).toContain('40');
    expect(error.message).toContain('build run ID');
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(10_000);
    expect((await errorOf(waitForPublishTurn(api, 0, timing))).code).toBe(
      'INVALID_INPUT',
    );
  });

  test('the release workflow waits for its turn right before it writes', async () => {
    const text = await readFile(
      new URL(
        '../../../.github/workflows/fixed-guest-release.yml',
        import.meta.url,
      ),
      'utf8',
    );
    const steps = (
      Bun.YAML.parse(text) as {
        jobs: { publish: { steps: { name?: string; run?: string }[] } };
      }
    ).jobs.publish.steps;
    const turn = steps.findIndex((step) => step.name === PUBLISH_TURN_STEP);
    const write = steps.findIndex((step) =>
      step.run?.includes('src/cli.ts release'),
    );
    expect(steps[turn]?.run).toContain('src/cli.ts publish-turn');
    expect(write).toBe(turn + 1);
  });

  test('keeps the default wait inside the publish job timeout, leaving time to publish', async () => {
    const text = await readFile(
      new URL(
        '../../../.github/workflows/fixed-guest-release.yml',
        import.meta.url,
      ),
      'utf8',
    );
    const timeout = (
      Bun.YAML.parse(text) as {
        jobs: { publish: { 'timeout-minutes': number } };
      }
    ).jobs.publish['timeout-minutes'];
    const { waitMs, settleMs, maxDelayMs, firstDelayMs } = PUBLISH_TURN_TIMING;
    // The longest a job can spend here before it starts to write.
    expect(waitMs + settleMs).toBeLessThanOrEqual(
      timeout * 60_000 - 5 * 60_000,
    );
    expect(firstDelayMs).toBeLessThan(maxDelayMs);
    const before = Date.now();
    await PUBLISH_TURN_TIMING.sleep(5);
    expect(PUBLISH_TURN_TIMING.now()).toBeGreaterThanOrEqual(before + 4);
  });

  test('does not wait for a publish whose turn step failed', async () => {
    const api = emptyApi();
    const failed = publishJob('completed');
    (failed.steps[1] as { conclusion: string | null }).conclusion = 'failure';
    withRun(api, 40, [failed]);
    const { timing, sleeps } = clock();
    await waitForPublishTurn(api, CURRENT, timing);
    expect(sleeps).toEqual([500]);
  });
});
