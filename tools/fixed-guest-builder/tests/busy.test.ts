import { describe, expect, test } from 'bun:test';
import { checkNotBusy, isBuildJob } from '../src/busy.ts';
import { BuildError } from '../src/errors.ts';
import { createGitHubApi } from '../src/github.ts';
import { FakeGitHub } from './helpers/fake-github.ts';

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

describe('checkNotBusy', () => {
  test('passes when the only active run is this one', async () => {
    const api = new FakeGitHub();
    api.runs = [{ id: 10, status: 'in_progress' }];
    await checkNotBusy(api, 'fixed-guest-build.yml', 10);
  });

  test('fails BUSY when another run is in progress', async () => {
    const api = new FakeGitHub();
    api.runs = [
      { id: 10, status: 'in_progress' },
      { id: 11, status: 'in_progress' },
    ];
    expect(
      await errorCode(checkNotBusy(api, 'fixed-guest-build.yml', 10)),
    ).toBe('BUSY');
  });

  test('does not count runs that wait for their turn or for approval', async () => {
    for (const status of ['queued', 'waiting', 'pending']) {
      const api = new FakeGitHub();
      api.runs = [
        { id: 10, status: 'in_progress' },
        { id: 11, status },
      ];
      expect(
        await errorCode(checkNotBusy(api, 'fixed-guest-release.yml', 10)),
      ).toBeUndefined();
    }
  });

  test('counts only the other runs whose matching job is in progress', async () => {
    const api = new FakeGitHub();
    api.runs = [
      { id: 10, status: 'in_progress' },
      { id: 11, status: 'in_progress' },
    ];
    const buildJob = (job: { name: string }) => job.name.startsWith('build ');
    // Run 11 has built and is now only releasing.
    api.jobs.set(11, [
      {
        name: 'build biome',
        status: 'completed',
        conclusion: 'success',
        steps: [],
      },
      {
        name: 'release / publish',
        status: 'in_progress',
        conclusion: null,
        steps: [],
      },
    ]);
    expect(
      await errorCode(checkNotBusy(api, 'fixed-guest-build.yml', 10, buildJob)),
    ).toBeUndefined();
    api.jobs.set(11, [
      {
        name: 'build biome',
        status: 'in_progress',
        conclusion: null,
        steps: [],
      },
    ]);
    expect(
      await errorCode(checkNotBusy(api, 'fixed-guest-build.yml', 10, buildJob)),
    ).toBe('BUSY');
  });

  test('a build counts only build jobs, not the release stage it calls', () => {
    const job = (name: string) => ({
      name,
      status: 'in_progress',
      conclusion: null,
      steps: [],
    });
    expect(isBuildJob(job('build biome'))).toBe(true);
    expect(isBuildJob(job('release / prepare'))).toBe(false);
    expect(isBuildJob(job('release / publish 0123'))).toBe(false);
  });

  test('passes when nothing else runs and refuses a missing run id', async () => {
    await checkNotBusy(new FakeGitHub(), 'fixed-guest-build.yml', 1);
    expect(
      await errorCode(
        checkNotBusy(new FakeGitHub(), 'fixed-guest-build.yml', 0),
      ),
    ).toBe('INVALID_INPUT');
  });

  test('asks GitHub for every active status of the named workflow', async () => {
    const urls: string[] = [];
    const api = createGitHubApi({
      repository: 'aletheia-works/vivarium',
      token: 't',
      fetcher: async (url) => {
        urls.push(url);
        return Response.json({
          workflow_runs: url.includes('status=in_progress')
            ? [{ id: 5, status: 'in_progress' }]
            : [],
        });
      },
    });
    expect(await errorCode(checkNotBusy(api, 'fixed-guest-build.yml', 4))).toBe(
      'BUSY',
    );
    expect(
      urls.map((url) => new URL(url).searchParams.get('status')).sort(),
    ).toEqual(['in_progress', 'pending', 'queued', 'requested', 'waiting']);
    expect(
      urls.every((url) =>
        url.includes('/actions/workflows/fixed-guest-build.yml/runs'),
      ),
    ).toBe(true);
  });

  test('reports an API failure as EXTERNAL rather than as not busy', async () => {
    const api = createGitHubApi({
      repository: 'a/b',
      token: 't',
      fetcher: async () => new Response('no', { status: 500 }),
    });
    expect(await errorCode(checkNotBusy(api, 'x.yml', 1))).toBe('EXTERNAL');
  });
});
