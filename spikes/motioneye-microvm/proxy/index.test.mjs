import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';

import {
  admit,
  connect,
  createProxy,
  previewMicrovm,
  responseMetadata,
  settings,
  sign,
  upstreamRequest,
} from './index.mjs';

const CONFIG = {
  region: 'ap-northeast-1',
  imageArn: 'arn:aws:lambda:ap-northeast-1:123456789012:microvm-image:preview',
  ingressConnector: 'arn:ingress',
  accessKey: 'open-sesame',
  tokenMinutes: 60,
  idlePolicy: {
    autoResumeEnabled: true,
    maxIdleDurationSeconds: 300,
    suspendedDurationSeconds: 3600,
  },
  maximumDurationInSeconds: 28_800,
};

function fakeApi(items = []) {
  const calls = [];
  return {
    calls,
    list: async () => {
      calls.push('list');
      return { items };
    },
    get: async (id) => {
      calls.push(`get ${id}`);
      return { microvmId: id, state: 'RUNNING', endpoint: `${id}.example` };
    },
    run: async (body) => {
      calls.push(`run ${body.clientToken}`);
      return { microvmId: 'mvm-new', state: 'PENDING' };
    },
    token: async (id, body) => {
      calls.push(`token ${id} ${body.allowedPorts[0].port}`);
      return { authToken: { 'X-aws-proxy-auth': `jwe-${calls.length}` } };
    },
  };
}

function sink() {
  const sent = [];
  const from = (responseStream, metadata) => {
    const stream = new PassThrough();
    sent.push({ metadata, body: text(stream) });
    return stream;
  };
  return { sent, from };
}

function admitted(overrides = {}) {
  const cookie = admit(CONFIG, { rawQueryString: 'vivarium-key=open-sesame' })
    .cookie.split(';')[0];
  return {
    rawPath: '/',
    rawQueryString: '',
    cookies: [cookie],
    headers: {},
    requestContext: { http: { method: 'GET' } },
    ...overrides,
  };
}

test('sign still matches the get-vanilla test vector', () => {
  const headers = sign({
    method: 'GET',
    host: 'example.amazonaws.com',
    path: '/',
    service: 'service',
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    },
    date: new Date('2015-08-30T12:36:00Z'),
  });
  assert.match(
    headers.authorization,
    /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/,
  );
});

test('settings refuses a missing access key', () => {
  assert.throws(
    () => settings({ IMAGE_ARN: 'a', INGRESS_CONNECTOR: 'b' }),
    /ACCESS_KEY is not set/,
  );
});

test('the key link sets the cookie and redirects without the key', () => {
  const admission = admit(CONFIG, {
    rawPath: '/config',
    rawQueryString: 'a=1&vivarium-key=open-sesame',
  });
  assert.equal(admission.status, 302);
  assert.equal(admission.location, '/config?a=1');
  assert.match(admission.cookie, /^vivarium-preview=[0-9a-f]{64}; .*HttpOnly; Secure/);
  assert.doesNotMatch(admission.cookie, /open-sesame/);
});

test('a wrong key, a wrong cookie and no cookie are refused', () => {
  assert.equal(admit(CONFIG, { rawQueryString: 'vivarium-key=nope' }).status, 403);
  assert.equal(admit(CONFIG, { cookies: ['vivarium-preview=00'] }).status, 403);
  assert.equal(admit(CONFIG, {}).status, 403);
  assert.equal(admit(CONFIG, admitted()).status, 200);
});

test('a live MicroVM is reused and none is started', async () => {
  const api = fakeApi([
    { microvmId: 'mvm-old', state: 'TERMINATED' },
    { microvmId: 'mvm-live', state: 'SUSPENDED' },
  ]);
  const microvm = await previewMicrovm(CONFIG, api);
  assert.equal(microvm.microvmId, 'mvm-live');
  assert.deepEqual(api.calls, ['list', 'get mvm-live']);
});

test('with no live MicroVM one is started with a per-minute client token', async () => {
  const api = fakeApi([{ microvmId: 'mvm-old', state: 'TERMINATED' }]);
  const now = Date.parse('2026-11-01T09:30:15Z');
  const microvm = await previewMicrovm(CONFIG, api, { now: () => now + 0 });
  assert.deepEqual(api.calls, ['list', 'run preview-202611010930', 'get mvm-new']);
  assert.equal(microvm.state, 'RUNNING');
});

test('connect asks for a token to the motionEye port only', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  const connection = await connect(CONFIG, api, { now: () => 1000 });
  assert.equal(connection.endpoint, 'mvm-live.example');
  assert.equal(api.calls.at(-1), 'token mvm-live 8765');
  assert.equal(connection.expiresAt, 1000 + 60 * 60_000);
});

test('the upstream request carries the token, the port and only motionEye cookies', () => {
  const event = admitted({
    rawPath: '/config/1/set/',
    rawQueryString: '_=1',
    cookies: [admitted().cookies[0], 'user=abc'],
    headers: {
      host: 'url.lambda-url.on.aws',
      'content-type': 'application/json',
      'x-amzn-trace-id': 'Root=1',
      'x-forwarded-for': '1.2.3.4',
    },
    requestContext: { http: { method: 'POST' } },
    body: Buffer.from('{"a":1}').toString('base64'),
    isBase64Encoded: true,
  });
  const { url, init } = upstreamRequest(event, { endpoint: 'mvm.example', token: 'jwe' });
  assert.equal(url, 'https://mvm.example/config/1/set/?_=1');
  assert.deepEqual(init.headers, {
    'content-type': 'application/json',
    cookie: 'user=abc',
    'x-aws-proxy-auth': 'jwe',
    'x-aws-proxy-port': '8765',
  });
  assert.equal(init.body.toString(), '{"a":1}');
  assert.equal(init.redirect, 'manual');
});

test('response cookies go to the cookies list and encoding headers are dropped', () => {
  const response = new Response('x', {
    status: 200,
    headers: [
      ['content-type', 'image/jpeg'],
      ['content-encoding', 'gzip'],
      ['set-cookie', 'user=abc; Path=/'],
      ['set-cookie', 'other=1'],
    ],
  });
  assert.deepEqual(responseMetadata(response), {
    statusCode: 200,
    headers: { 'content-type': 'image/jpeg' },
    cookies: ['user=abc; Path=/', 'other=1'],
  });
});

test('the proxy streams motionEye back and reuses its connection', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([url, init.headers['x-aws-proxy-auth']]);
    return new Response('jpeg bytes', { headers: { 'content-type': 'image/jpeg' } });
  };
  const { sent, from } = sink();
  const respond = createProxy({ config: CONFIG, api, fetchImpl, from, now: () => 0 });
  await respond(admitted({ rawPath: '/picture/1/current/' }), {});
  await respond(admitted({ rawPath: '/picture/2/current/' }), {});
  assert.deepEqual(seen, [
    ['https://mvm-live.example/picture/1/current/', 'jwe-3'],
    ['https://mvm-live.example/picture/2/current/', 'jwe-3'],
  ]);
  assert.equal(sent[0].metadata.statusCode, 200);
  assert.equal(await sent[1].body, 'jpeg bytes');
  assert.equal(api.calls.filter((c) => c.startsWith('token')).length, 1);
});

test('a failed fetch drops the connection and retries once with a new one', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response('ok');
  };
  const { sent, from } = sink();
  const respond = createProxy({ config: CONFIG, api, fetchImpl, from, now: () => 0 });
  await respond(admitted(), {});
  assert.equal(calls, 2);
  assert.equal(api.calls.filter((c) => c.startsWith('token')).length, 2);
  assert.equal(await sent[0].body, 'ok');
});

test('the proxy refuses without the cookie and answers 503 when motionEye stays unreachable', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  const { sent, from } = sink();
  const respond = createProxy({
    config: CONFIG,
    api,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    from,
    now: () => 0,
  });
  await respond({ rawPath: '/', requestContext: { http: { method: 'GET' } } }, {});
  assert.equal(sent[0].metadata.statusCode, 403);
  assert.deepEqual(api.calls, []);
  await respond(admitted(), {});
  assert.equal(sent[1].metadata.statusCode, 503);
});
