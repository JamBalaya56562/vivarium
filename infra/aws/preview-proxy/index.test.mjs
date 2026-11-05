import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';

import {
  admit,
  connect,
  createProxy,
  createRouter,
  fromSibling,
  microvms,
  previewMicrovm,
  previewName,
  responseMetadata,
  settings,
  sign,
  upstreamRequest,
} from './index.mjs';
import { seal } from './session.mjs';

const CONFIG = {
  region: 'ap-northeast-1',
  imageArn: 'arn:aws:lambda:ap-northeast-1:123456789012:microvm-image:preview',
  ingressConnector: 'arn:ingress',
  egressConnector: 'arn:egress',
  preview: 'motioneye-1',
  authUrl: 'https://auth.example',
  sessionKey: 'open-sesame',
  routes: { '/': 8765, '/mailpit': 8025, '/uploads': 8030 },
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
  const runs = [];
  return {
    calls,
    runs,
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
      runs.push(body);
      return { microvmId: 'mvm-new', state: 'PENDING' };
    },
    token: async (id, body) => {
      calls.push(
        `token ${id} ${body.allowedPorts.map((p) => p.port).join(',')}`,
      );
      return { authToken: { 'X-aws-proxy-auth': `jwe-${calls.length}` } };
    },
  };
}

function sink() {
  const sent = [];
  const from = (_responseStream, metadata) => {
    const stream = new PassThrough();
    const response = { body: text(stream) };
    sent.push(response);
    const write = stream.write.bind(stream);
    const end = stream.end.bind(stream);
    stream.write = (chunk, ...rest) => {
      response.metadata ??= metadata;
      return write(chunk, ...rest);
    };
    stream.end = (callback) =>
      end(typeof callback === 'function' ? callback : undefined);
    return stream;
  };
  return { sent, from };
}

const NOW = Date.parse('2026-11-01T09:00:00Z');

const ticket = (overrides = {}) =>
  seal('open-sesame', {
    type: 'ticket',
    preview: 'motioneye-1',
    login: 'octocat',
    expires: NOW + 60_000,
    ...overrides,
  });

function admitted(overrides = {}) {
  const cookie = admit(
    CONFIG,
    { rawQueryString: `vivarium-ticket=${encodeURIComponent(ticket())}` },
    NOW,
  ).cookie.split(';')[0];
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

const ENV = {
  PREVIEWS: '{"motioneye-1":{"imageArn":"arn:image"}}',
  INGRESS_CONNECTOR: 'b',
  EGRESS_CONNECTOR: 'c',
  DOMAIN: 'Previews.Example',
  AUTH_URL: 'https://sign-in.previews.example/',
  SESSION_KEY: 'f',
  ROUTES: '{"/":8080,"/admin":9090}',
  AWS_ACCESS_KEY_ID: 'g',
  AWS_SECRET_ACCESS_KEY: 'h',
};

test('settings refuses a missing setting', () => {
  for (const name of [
    'PREVIEWS',
    'INGRESS_CONNECTOR',
    'EGRESS_CONNECTOR',
    'DOMAIN',
    'AUTH_URL',
    'SESSION_KEY',
    'ROUTES',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ]) {
    const { [name]: _, ...env } = ENV;
    assert.throws(() => settings(env), new RegExp(`${name} is not set`));
  }
});

test('settings gives each preview its image, routes and sign-in URL', () => {
  const { domain, previews } = settings(ENV);
  assert.equal(domain, 'previews.example');
  assert.equal(previews['motioneye-1'].preview, 'motioneye-1');
  assert.equal(previews['motioneye-1'].imageArn, 'arn:image');
  assert.equal(
    previews['motioneye-1'].authUrl,
    'https://sign-in.previews.example',
  );
  assert.deepEqual(previews['motioneye-1'].routes, {
    '/': 8080,
    '/admin': 9090,
  });
  assert.throws(
    () => settings({ ...ENV, ROUTES: '{"/admin":9090}' }),
    /ROUTES has no port for \//,
  );
});

test('a ticket sets the session cookie and redirects without the ticket', () => {
  const admission = admit(
    CONFIG,
    {
      rawPath: '/config',
      rawQueryString: `a=1&vivarium-ticket=${encodeURIComponent(ticket())}`,
    },
    NOW,
  );
  assert.equal(admission.status, 302);
  assert.equal(admission.location, '/config?a=1');
  assert.equal(admission.login, 'octocat');
  assert.match(
    admission.cookie,
    /^__Host-vivarium-preview=[\w-]+\.[\w-]+; Path=\/; Max-Age=86400; HttpOnly; Secure/,
  );
  assert.doesNotMatch(admission.cookie, /open-sesame/);
});

test('an expired, forged or other preview ticket is refused', () => {
  const refused = (token) =>
    admit(
      CONFIG,
      { rawQueryString: `vivarium-ticket=${encodeURIComponent(token)}` },
      NOW,
    ).status;
  assert.equal(refused(ticket({ expires: NOW })), 403);
  assert.equal(refused(ticket({ preview: 'motioneye-2' })), 403);
  assert.equal(refused(ticket({ type: 'session' })), 403);
  assert.equal(refused(`${ticket().split('.')[0]}.forged`), 403);
  assert.equal(
    refused(
      seal('another-key', {
        type: 'ticket',
        preview: 'motioneye-1',
        login: 'octocat',
        expires: NOW + 60_000,
      }),
    ),
    403,
  );
});

test('without a valid session the request goes to the sign-in, path and query kept', () => {
  const session = admitted().cookies[0];
  assert.equal(admit(CONFIG, admitted(), NOW).status, 200);
  assert.equal(admit(CONFIG, admitted(), NOW + 86_400_000).status, 302);
  assert.deepEqual(
    admit(CONFIG, { rawPath: '//evil.example/x', rawQueryString: 'a=1' }, NOW),
    {
      status: 302,
      location: 'https://auth.example/motioneye-1/evil.example/x?a=1',
    },
  );
  assert.equal(
    admit({ ...CONFIG, preview: 'motioneye-2' }, { cookies: [session] }, NOW)
      .location,
    'https://auth.example/motioneye-2/',
  );
});

test('a public path is answered without a session to GET and HEAD only', () => {
  const config = {
    ...CONFIG,
    publicPaths: new Set(['/manifest.json', '/static/img/motioneye-icon.svg']),
  };
  const request = (rawPath, method = 'GET') =>
    admit(
      config,
      { rawPath, rawQueryString: 'v=1', requestContext: { http: { method } } },
      NOW,
    ).status;
  assert.equal(request('/manifest.json'), 200);
  assert.equal(request('/manifest.json', 'HEAD'), 200);
  assert.equal(request('/static/img/motioneye-icon.svg'), 200);
  assert.equal(request('/manifest.json', 'POST'), 302);
  assert.equal(request('/manifest.json/'), 302);
  assert.equal(request('/config'), 302);
  assert.equal(admit(CONFIG, { rawPath: '/manifest.json' }, NOW).status, 302);
});

test('settings reads the public paths, none by default', () => {
  const paths = (preview) =>
    settings({ ...ENV, PREVIEWS: JSON.stringify({ 'motioneye-1': preview }) })
      .previews['motioneye-1'].publicPaths;
  assert.deepEqual([...paths({ imageArn: 'a' })], []);
  assert.deepEqual(
    [...paths({ imageArn: 'a', public: ['/manifest.json'] })],
    ['/manifest.json'],
  );
  assert.throws(
    () => paths({ imageArn: 'a', public: '/manifest.json' }),
    /motioneye-1: public is not a list of paths/,
  );
});

test('a host names its preview only under the domain', () => {
  assert.equal(
    previewName('previews.example', 'Motioneye-1.Previews.Example'),
    'motioneye-1',
  );
  assert.equal(previewName('previews.example', 'previews.example'), undefined);
  assert.equal(
    previewName('previews.example', 'motioneye-1.other.example'),
    undefined,
  );
  assert.equal(previewName('previews.example', undefined), undefined);
});

test('the router sends a request to the proxy of its preview, and any other host to 404', async () => {
  const seen = [];
  const respond = createRouter({
    config: {
      domain: 'previews.example',
      previews: { 'motioneye-1': { preview: 'motioneye-1' } },
    },
    from: (stream, metadata) => {
      stream.metadata = metadata;
      return stream;
    },
    proxyFor: (preview) => (event) =>
      seen.push([preview.preview, event.rawPath]),
  });
  await respond(
    {
      rawPath: '/config',
      headers: { 'x-vivarium-host': 'motioneye-1.previews.example' },
    },
    new PassThrough(),
  );
  assert.deepEqual(seen, [['motioneye-1', '/config']]);
  for (const headers of [
    { 'x-vivarium-host': 'motioneye-2.previews.example' },
    {},
  ]) {
    const stream = new PassThrough();
    await respond({ rawPath: '/', headers }, stream);
    assert.equal(stream.metadata.statusCode, 404);
  }
  assert.equal(seen.length, 1);
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
  assert.deepEqual(api.calls, [
    'list',
    'run preview-202611010930',
    'get mvm-new',
  ]);
  assert.equal(microvm.state, 'RUNNING');
});

test('a started MicroVM sends its outbound traffic only through the egress connector', async () => {
  const api = fakeApi([]);
  await previewMicrovm(CONFIG, api, { now: () => 0 });
  assert.deepEqual(api.runs[0].egressNetworkConnectors, ['arn:egress']);
});

test("connect asks for a token to the routes' ports only", async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  const connection = await connect(CONFIG, api, { now: () => 1000 });
  assert.equal(connection.endpoint, 'mvm-live.example');
  assert.equal(api.calls.at(-1), 'token mvm-live 8765,8025,8030');
  assert.equal(connection.expiresAt, 1000 + 60 * 60_000);
});

test('the upstream request carries the token, the port and only motionEye cookies', () => {
  const event = admitted({
    rawPath: '/config/1/set/',
    rawQueryString: '_=1',
    cookies: [admitted().cookies[0], 'user=abc'],
    headers: {
      host: 'endpoint.lambda-web.ap-northeast-1.on.aws',
      authorization: 'Bearer meye_key',
      'content-type': 'application/json',
      'lambda-web-request-id': 'request',
      'x-amz-security-token': 'aws-token',
      'x-amzn-trace-id': 'Root=1',
      'x-forwarded-for': '1.2.3.4',
      'x-vivarium-host': 'motioneye-1.previews.example',
    },
    requestContext: { http: { method: 'POST' } },
    body: Buffer.from('{"a":1}').toString('base64'),
    isBase64Encoded: true,
  });
  const { url, init } = upstreamRequest(
    event,
    { endpoint: 'mvm.example', token: 'jwe' },
    CONFIG.routes,
  );
  assert.equal(url, 'https://mvm.example/config/1/set/?_=1');
  assert.deepEqual(init.headers, {
    authorization: 'Bearer meye_key',
    'content-type': 'application/json',
    cookie: 'user=abc',
    'x-aws-proxy-auth': 'jwe',
    'x-aws-proxy-port': '8765',
  });
  assert.equal(init.body.toString(), '{"a":1}');
  assert.equal(init.redirect, 'manual');
});

test('a path goes to the port of its longest route prefix, or to the port for /', () => {
  const port = (rawPath, routes = CONFIG.routes) =>
    upstreamRequest(
      admitted({ rawPath }),
      { endpoint: 'mvm.example', token: 'jwe' },
      routes,
    ).init.headers['x-aws-proxy-port'];
  assert.equal(port('/mailpit/'), '8025');
  assert.equal(port('/mailpit/api/v1/messages'), '8025');
  assert.equal(port('/mailpit'), '8025');
  assert.equal(port('/mailpitx/'), '8765');
  assert.equal(port('/uploads/'), '8030');
  assert.equal(port('/uploads/files/ftp/a.jpg'), '8030');
  assert.equal(port('/uploadsx'), '8765');
  assert.equal(port('/picture/1/current/'), '8765');
  const nested = { '/': 1, '/a': 2, '/a/b': 3 };
  assert.equal(port('/a/b/c', nested), '3');
  assert.equal(port('/a/c', nested), '2');
  assert.equal(port('/b', nested), '1');
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
    return new Response('jpeg bytes', {
      headers: { 'content-type': 'image/jpeg' },
    });
  };
  const { sent, from } = sink();
  const respond = createProxy({
    config: CONFIG,
    api,
    fetchImpl,
    from,
    now: () => 0,
  });
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

test('a public path reaches only a running MicroVM and never starts or resumes one', async () => {
  const config = { ...CONFIG, publicPaths: new Set(['/manifest.json']) };
  const manifest = { rawPath: '/manifest.json', rawQueryString: 'v=1' };
  const answer = async (api) => {
    const { sent, from } = sink();
    const respond = createProxy({
      config,
      api,
      fetchImpl: async () => new Response('{}'),
      from,
      now: () => 0,
    });
    await respond(manifest, {});
    return sent[0].metadata.statusCode;
  };
  const none = fakeApi();
  assert.equal(await answer(none), 503);
  assert.deepEqual(none.calls, ['list']);
  const suspended = fakeApi([{ microvmId: 'mvm-live', state: 'SUSPENDED' }]);
  suspended.get = async (id) => ({
    microvmId: id,
    state: 'SUSPENDED',
    endpoint: `${id}.example`,
  });
  assert.equal(await answer(suspended), 503);
  assert.equal(
    await answer(fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }])),
    200,
  );
});

test('a public request whose MicroVM ends before the retry does not start one', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  const list = api.list;
  let lists = 0;
  api.list = async (...args) => {
    lists += 1;
    return lists > 2 ? { items: [] } : list(...args);
  };
  const { sent, from } = sink();
  const respond = createProxy({
    config: { ...CONFIG, publicPaths: new Set(['/manifest.json']) },
    api,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    from,
    now: () => 0,
  });
  await respond({ rawPath: '/manifest.json' }, {});
  assert.equal(sent[0].metadata.statusCode, 503);
  assert.deepEqual(
    api.calls.filter((c) => c.startsWith('run')),
    [],
  );
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
  const respond = createProxy({
    config: CONFIG,
    api,
    fetchImpl,
    from,
    now: () => 0,
  });
  await respond(admitted(), {});
  assert.equal(calls, 2);
  assert.equal(api.calls.filter((c) => c.startsWith('token')).length, 2);
  assert.equal(await sent[0].body, 'ok');
});

test('the proxy sends a request without a session to the sign-in and answers 503 when motionEye stays unreachable', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  const { sent, from } = sink();
  const respond = createProxy({
    config: CONFIG,
    api,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    from,
    now: () => NOW,
  });
  await respond(
    { rawPath: '/', requestContext: { http: { method: 'GET' } } },
    {},
  );
  assert.equal(sent[0].metadata.statusCode, 302);
  assert.equal(
    sent[0].metadata.headers.location,
    'https://auth.example/motioneye-1/',
  );
  assert.deepEqual(api.calls, []);
  await respond(admitted(), {});
  assert.equal(sent[1].metadata.statusCode, 503);
});

test('bodyless answers still send their status, the ticket redirect and an upstream 304', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  const { sent, from } = sink();
  const respond = createProxy({
    config: CONFIG,
    api,
    fetchImpl: async () => new Response(null, { status: 304 }),
    from,
    now: () => NOW,
  });
  await respond(
    {
      rawPath: '/',
      rawQueryString: `vivarium-ticket=${encodeURIComponent(ticket())}`,
    },
    {},
  );
  assert.equal(sent[0].metadata.statusCode, 302);
  assert.equal(sent[0].metadata.headers.location, '/');
  assert.equal(sent[0].metadata.cookies.length, 1);
  await respond(admitted(), {});
  assert.equal(sent[1].metadata.statusCode, 304);
});

test('the ticket redirect stays on the preview host', () => {
  const query = `vivarium-ticket=${encodeURIComponent(ticket())}`;
  const admission = admit(
    CONFIG,
    { rawPath: '//evil.example/x', rawQueryString: query },
    NOW,
  );
  assert.equal(admission.location, '/evil.example/x');
  const backslashed = admit(
    CONFIG,
    { rawPath: '/\\evil.example/x', rawQueryString: query },
    NOW,
  );
  assert.equal(backslashed.location, '/evil.example/x');
});

test('a reused MicroVM that is still starting is waited for', async () => {
  const api = fakeApi([{ microvmId: 'mvm-starting', state: 'PENDING' }]);
  const get = api.get;
  let gets = 0;
  api.get = async (id) => {
    gets += 1;
    return gets === 1 ? { microvmId: id, state: 'PENDING' } : get(id);
  };
  const microvm = await previewMicrovm(CONFIG, api);
  assert.equal(microvm.state, 'RUNNING');
  assert.equal(microvm.endpoint, 'mvm-starting.example');
});

test('a write is not sent twice after a failed fetch', async () => {
  const api = fakeApi([{ microvmId: 'mvm-live', state: 'RUNNING' }]);
  let calls = 0;
  const { sent, from } = sink();
  const respond = createProxy({
    config: CONFIG,
    api,
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    },
    from,
    now: () => 0,
  });
  await respond(
    admitted({ requestContext: { http: { method: 'POST' } }, body: '{}' }),
    {},
  );
  assert.equal(calls, 1);
  assert.equal(sent[0].metadata.statusCode, 503);
});

test('a request from a sibling host is refused unless it is a top-level navigation', () => {
  const event = (method, site, dest) => ({
    requestContext: { http: { method } },
    headers: { 'sec-fetch-site': site, 'sec-fetch-dest': dest },
  });
  assert.equal(fromSibling(event('POST', 'same-site', 'empty')), true);
  assert.equal(fromSibling(event('GET', 'same-site', 'empty')), true);
  assert.equal(fromSibling(event('GET', 'same-site', 'iframe')), true);
  assert.equal(fromSibling(event('POST', 'same-site', 'document')), true);
  assert.equal(fromSibling(event('GET', 'same-site', 'document')), false);
  assert.equal(fromSibling(event('HEAD', 'same-site', 'document')), false);
  assert.equal(fromSibling(event('POST', 'same-origin', 'empty')), false);
  assert.equal(fromSibling(event('GET', 'cross-site', 'document')), false);
  assert.equal(fromSibling({}), false);
});

test('a sibling request with a valid session gets 403 and never reaches the MicroVM', async () => {
  const api = fakeApi();
  const { sent, from } = sink();
  let fetched = false;
  const respond = createProxy({
    config: CONFIG,
    api,
    fetchImpl: async () => {
      fetched = true;
      return new Response('');
    },
    from,
    now: () => NOW,
  });
  await respond(
    admitted({
      requestContext: { http: { method: 'POST' } },
      headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'empty' },
    }),
    {},
  );
  assert.equal(sent[0].metadata.statusCode, 403);
  assert.equal(sent[0].metadata.headers['cache-control'], 'no-store');
  assert.equal(fetched, false);
  assert.deepEqual(api.calls, []);
});

test('a HEAD request drops its body, as a GET does', () => {
  for (const method of ['GET', 'HEAD']) {
    const { init } = upstreamRequest(
      {
        rawPath: '/',
        body: 'e30=',
        isBase64Encoded: true,
        requestContext: { http: { method } },
      },
      { endpoint: 'mvm.example', token: 'jwe' },
      CONFIG.routes,
    );
    assert.equal(init.body, undefined);
  }
});

test('each call signs with the credentials the environment holds at that moment', async () => {
  const env = {
    ...ENV,
    AWS_REGION: 'ap-northeast-1',
    AWS_ACCESS_KEY_ID: 'first',
  };
  const config = settings(env).previews['motioneye-1'];
  const seen = [];
  const api = microvms(config, async (_url, { headers }) => {
    seen.push(headers.authorization.match(/Credential=([^/]+)/)[1]);
    return Response.json({});
  });
  await api.get('a');
  env.AWS_ACCESS_KEY_ID = 'second';
  await api.get('a');
  assert.deepEqual(seen, ['first', 'second']);
});
