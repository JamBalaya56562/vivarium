import assert from 'node:assert/strict';
import { test } from 'node:test';

import { endMicrovms } from './end-microvms.mjs';
import { microvms } from './index.mjs';

const IMAGE = 'arn:aws:lambda:ap-northeast-1:123456789012:microvm-image:gone';

function fakeApi(rounds) {
  const calls = [];
  let round = 0;
  return {
    calls,
    list: async (imageArn, nextToken) => {
      calls.push(`list ${imageArn} ${nextToken ?? '-'}`);
      const pages = rounds[Math.min(round, rounds.length - 1)];
      const page = pages[nextToken ? Number(nextToken) : 0];
      if (!page.nextToken) round++;
      return page;
    },
    terminate: async (id) => {
      calls.push(`terminate ${id}`);
      return {};
    },
  };
}

const clock = () => {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
};

test('terminates every live MicroVM of the image and waits until they end', async () => {
  const api = fakeApi([
    [
      {
        items: [
          { microvmId: 'mvm-old', state: 'TERMINATED' },
          { microvmId: 'mvm-idle', state: 'SUSPENDED' },
        ],
        nextToken: '1',
      },
      { items: [{ microvmId: 'mvm-busy', state: 'RUNNING' }] },
    ],
    [{ items: [{ microvmId: 'mvm-idle', state: 'TERMINATING' }] }],
    [{ items: [{ microvmId: 'mvm-idle', state: 'TERMINATED' }] }],
  ]);
  await endMicrovms(api, [IMAGE], { ...clock(), log: () => {} });
  assert.deepEqual(
    api.calls.filter((c) => c.startsWith('terminate')),
    ['terminate mvm-idle', 'terminate mvm-busy'],
  );
  assert.equal(api.calls.filter((c) => c.startsWith('list')).length, 4);
});

test('leaves an image without live MicroVMs alone', async () => {
  const api = fakeApi([
    [{ items: [{ microvmId: 'mvm-old', state: 'TERMINATED' }] }],
  ]);
  await endMicrovms(api, [IMAGE], { ...clock(), log: () => {} });
  assert.deepEqual(api.calls, [`list ${IMAGE} -`]);
});

test('gives up when a MicroVM does not end in time', async () => {
  const api = fakeApi([
    [{ items: [{ microvmId: 'mvm-stuck', state: 'TERMINATING' }] }],
  ]);
  await assert.rejects(
    endMicrovms(api, [IMAGE], { ...clock(), log: () => {} }),
    /mvm-stuck/,
  );
});

test('terminate sends DELETE to the MicroVM', async () => {
  const seen = [];
  const api = microvms(
    {
      region: 'ap-northeast-1',
      credentials: () => ({ accessKeyId: 'AKID', secretAccessKey: 'secret' }),
    },
    async (url, init) => {
      seen.push(`${init.method} ${url}`);
      return new Response('', { status: 200 });
    },
  );
  await api.terminate('mvm-1');
  assert.deepEqual(seen, [
    'DELETE https://lambda.ap-northeast-1.amazonaws.com/2025-09-09/microvms/mvm-1',
  ]);
});
