import { afterEach, describe, expect, test } from 'bun:test';
import { inheritedEnvironment, runProcess } from '../src/process.ts';

const saved = { ...process.env };
afterEach(() => {
  for (const name of [
    'GITHUB_TOKEN',
    'ACTIONS_RUNTIME_TOKEN',
    'MY_SECRET',
    'GH_TOKEN',
  ])
    delete process.env[name];
  Object.assign(process.env, saved);
});

describe('inheritedEnvironment', () => {
  test('withholds workflow tokens and secrets but keeps the rest', () => {
    const env = inheritedEnvironment({
      PATH: '/bin',
      HOME: '/home/runner',
      GITHUB_TOKEN: 'ghs_x',
      GH_TOKEN: 'ghs_y',
      ACTIONS_RUNTIME_TOKEN: 'z',
      ACTIONS_CACHE_URL: 'https://example.invalid',
      NPM_TOKEN: 'n',
      MY_SECRET: 's',
      DB_PASSWORD: 'p',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    });
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/runner',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    });
  });

  test('child processes do not see the token, but an explicit value still passes', async () => {
    process.env.GITHUB_TOKEN = 'ghs_should_not_leak';
    process.env.ACTIONS_RUNTIME_TOKEN = 'runtime_should_not_leak';
    const inherited = await runProcess('sh', [
      '-c',
      'printenv GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN; echo done',
    ]);
    expect(inherited.stdout.trim()).toBe('done');
    const explicit = await runProcess('sh', ['-c', 'echo "$GH_TOKEN"'], {
      env: { GH_TOKEN: 'given' },
    });
    expect(explicit.stdout.trim()).toBe('given');
  });
});
