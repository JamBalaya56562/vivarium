import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { localPath, seal, unseal } from './session.mjs';

const API_VERSION = '2025-09-09';
const LIVE_STATES = new Set(['PENDING', 'RUNNING', 'SUSPENDING', 'SUSPENDED']);
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 1_000;
const TOKEN_MARGIN_MS = 60_000;
const COOKIE = 'vivarium-preview';
const SESSION_SECONDS = 86_400;
const REPEATABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PUBLIC_METHODS = new Set(['GET', 'HEAD']);
const TICKET_PARAM = 'vivarium-ticket';
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'cookie',
  'content-length',
  'connection',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-port',
]);
const DROPPED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
]);

export function settings(env = process.env) {
  for (const name of [
    'IMAGE_ARN',
    'INGRESS_CONNECTOR',
    'EGRESS_CONNECTOR',
    'PREVIEW',
    'AUTH_URL',
    'SESSION_KEY',
    'ROUTES',
  ])
    if (!env[name]) throw new Error(`${name} is not set`);
  const routes = JSON.parse(env.ROUTES);
  if (!Number.isInteger(routes['/']))
    throw new Error('ROUTES has no port for /');
  const publicPaths = JSON.parse(env.PUBLIC_PATHS ?? '[]');
  if (
    !Array.isArray(publicPaths) ||
    !publicPaths.every((path) => typeof path === 'string')
  )
    throw new Error('PUBLIC_PATHS is not a list of paths');
  return {
    region: env.AWS_REGION,
    imageArn: env.IMAGE_ARN,
    ingressConnector: env.INGRESS_CONNECTOR,
    egressConnector: env.EGRESS_CONNECTOR,
    preview: env.PREVIEW,
    authUrl: env.AUTH_URL.replace(/\/+$/, ''),
    sessionKey: env.SESSION_KEY,
    routes,
    publicPaths: new Set(publicPaths),
    tokenMinutes: Number(env.TOKEN_MINUTES ?? 60),
    idlePolicy: {
      autoResumeEnabled: true,
      maxIdleDurationSeconds: Number(env.IDLE_SECONDS ?? 300),
      suspendedDurationSeconds: Number(env.SUSPENDED_SECONDS ?? 3600),
    },
    maximumDurationInSeconds: Number(env.MAX_SECONDS ?? 28_800),
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    },
  };
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encode = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function sign({
  method,
  host,
  path,
  query = {},
  body = '',
  service,
  region,
  credentials,
  date = new Date(),
}) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers = {
    host,
    'x-amz-date': amzDate,
    ...(credentials.sessionToken
      ? { 'x-amz-security-token': credentials.sessionToken }
      : {}),
    ...(body ? { 'content-type': 'application/json' } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encode(key)}=${encode(String(query[key]))}`)
    .join('&');
  const canonical = [
    method,
    path.split('/').map(encode).join('/'),
    canonicalQuery,
    names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join(''),
    names.join(';'),
    sha256(body),
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join(
    '\n',
  );
  let key = `AWS4${credentials.secretAccessKey}`;
  for (const part of [day, region, service, 'aws4_request'])
    key = hmac(key, part);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

export function microvms(config, fetchImpl = fetch) {
  const host = `lambda.${config.region}.amazonaws.com`;
  async function call(method, path, { query = {}, body } = {}) {
    const text = body === undefined ? '' : JSON.stringify(body);
    const fullPath = `/${API_VERSION}${path}`;
    const headers = sign({
      method,
      host,
      path: fullPath,
      query,
      body: text,
      service: 'lambda',
      region: config.region,
      credentials: config.credentials,
    });
    const search = new URLSearchParams(query).toString();
    const response = await fetchImpl(
      `https://${host}${fullPath}${search ? `?${search}` : ''}`,
      { method, headers, ...(text ? { body: text } : {}) },
    );
    const answer = await response.text();
    if (!response.ok)
      throw new Error(
        `${method} ${path} failed with ${response.status}: ${answer.slice(0, 500)}`,
      );
    return answer ? JSON.parse(answer) : {};
  }
  return {
    list: (imageIdentifier, nextToken) =>
      call('GET', '/microvms', {
        query: { imageIdentifier, ...(nextToken ? { nextToken } : {}) },
      }),
    get: (id) => call('GET', `/microvms/${encodeURIComponent(id)}`),
    run: (body) => call('POST', '/microvms', { body }),
    terminate: (id) => call('DELETE', `/microvms/${encodeURIComponent(id)}`),
    token: (id, body) =>
      call('POST', `/microvms/${encodeURIComponent(id)}/auth-token`, { body }),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function liveMicrovm(config, api) {
  let nextToken;
  do {
    const page = await api.list(config.imageArn, nextToken);
    const live = (page.items ?? []).find((item) => LIVE_STATES.has(item.state));
    if (live) return api.get(live.microvmId);
    nextToken = page.nextToken;
  } while (nextToken);
}

export async function previewMicrovm(
  config,
  api,
  { now = Date.now, start = true } = {},
) {
  const live = await liveMicrovm(config, api);
  if (!start && live?.state !== 'RUNNING')
    throw new Error(`the preview MicroVM is ${live?.state ?? 'not running'}`);
  let microvm =
    live ??
    (await api.run({
      imageIdentifier: config.imageArn,
      ingressNetworkConnectors: [config.ingressConnector],
      egressNetworkConnectors: [config.egressConnector],
      idlePolicy: config.idlePolicy,
      maximumDurationInSeconds: config.maximumDurationInSeconds,
      clientToken: `preview-${new Date(now())
        .toISOString()
        .slice(0, 16)
        .replace(/\D/g, '')}`,
    }));
  const deadline = now() + START_TIMEOUT_MS;
  while (microvm.state === 'PENDING' && now() < deadline) {
    await sleep(POLL_MS);
    microvm = await api.get(microvm.microvmId);
  }
  return microvm;
}

export async function connect(config, api, options = {}) {
  const { now = Date.now } = options;
  const microvm = await previewMicrovm(config, api, options);
  if (!microvm.endpoint || !LIVE_STATES.has(microvm.state))
    throw new Error(`the preview MicroVM is ${microvm.state}`);
  const { authToken } = await api.token(microvm.microvmId, {
    expirationInMinutes: config.tokenMinutes,
    allowedPorts: [...new Set(Object.values(config.routes))].map((port) => ({
      port,
    })),
  });
  const token = authToken?.['X-aws-proxy-auth'];
  if (!token) throw new Error('Lambda returned no token');
  return {
    endpoint: microvm.endpoint,
    token,
    expiresAt: now() + config.tokenMinutes * 60_000,
  };
}

function ownCookie(cookies = []) {
  const prefix = `${COOKIE}=`;
  return cookies.find((c) => c.startsWith(prefix))?.slice(prefix.length);
}

export function admit(config, event, now = Date.now()) {
  const query = new URLSearchParams(event.rawQueryString ?? '');
  const ticket = query.get(TICKET_PARAM);
  if (ticket !== null) {
    const pass = unseal(config.sessionKey, ticket, 'ticket', now);
    if (!pass || pass.preview !== config.preview) return { status: 403 };
    query.delete(TICKET_PARAM);
    const rest = query.toString();
    const session = seal(config.sessionKey, {
      type: 'session',
      preview: config.preview,
      login: pass.login,
      expires: now + SESSION_SECONDS * 1000,
    });
    return {
      status: 302,
      login: pass.login,
      location: `${localPath(event.rawPath)}${rest ? `?${rest}` : ''}`,
      cookie: `${COOKIE}=${session}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    };
  }
  const session = unseal(
    config.sessionKey,
    ownCookie(event.cookies),
    'session',
    now,
  );
  if (session?.preview === config.preview) return { status: 200 };
  if (
    config.publicPaths?.has(event.rawPath) &&
    PUBLIC_METHODS.has(event.requestContext?.http?.method ?? 'GET')
  )
    return { status: 200, public: true };
  const search = event.rawQueryString ? `?${event.rawQueryString}` : '';
  return {
    status: 302,
    location: `${config.authUrl}/${config.preview}${localPath(event.rawPath)}${search}`,
  };
}

function upstreamPort(routes, path) {
  const prefix = Object.keys(routes)
    .filter((p) => p !== '/' && (path === p || path.startsWith(`${p}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return routes[prefix ?? '/'];
}

export function upstreamRequest(event, connection, routes) {
  const headers = {};
  for (const [name, value] of Object.entries(event.headers ?? {}))
    if (!DROPPED_REQUEST_HEADERS.has(name) && !name.startsWith('x-amzn-'))
      headers[name] = value;
  const cookies = (event.cookies ?? []).filter(
    (c) => !c.startsWith(`${COOKIE}=`),
  );
  if (cookies.length) headers.cookie = cookies.join('; ');
  headers['x-aws-proxy-auth'] = connection.token;
  headers['x-aws-proxy-port'] = String(
    upstreamPort(routes, event.rawPath || '/'),
  );
  const method = event.requestContext?.http?.method ?? 'GET';
  const body =
    event.body === undefined || event.body === null || method === 'GET'
      ? undefined
      : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  return {
    url: `https://${connection.endpoint}${event.rawPath || '/'}${query}`,
    init: { method, headers, body, redirect: 'manual' },
  };
}

export function responseMetadata(response) {
  const headers = {};
  for (const [name, value] of response.headers)
    if (!DROPPED_RESPONSE_HEADERS.has(name)) headers[name] = value;
  return {
    statusCode: response.status,
    headers,
    cookies: response.headers.getSetCookie(),
  };
}

function open(from, responseStream, metadata) {
  const stream = from(responseStream, metadata);
  stream.write('');
  return stream;
}

function plain(responseStream, from, statusCode, text, extra = {}) {
  const stream = open(from, responseStream, {
    statusCode,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
    ...extra,
  });
  stream.write(text);
  stream.end();
}

export function createProxy({
  config,
  api,
  fetchImpl = fetch,
  from,
  now = Date.now,
}) {
  let connection;
  async function current(start) {
    if (!connection || connection.expiresAt - TOKEN_MARGIN_MS < now())
      connection = await connect(config, api, { now, start });
    return connection;
  }
  return async function respond(event, responseStream) {
    const admission = admit(config, event, now());
    if (admission.status === 403)
      return plain(
        responseStream,
        from,
        403,
        'This sign-in link has expired. Open the preview link again.\n',
      );
    if (admission.status === 302) {
      if (admission.login)
        console.log(`admitted ${admission.login} to ${config.preview}`);
      return plain(responseStream, from, 302, '', {
        headers: { location: admission.location, 'cache-control': 'no-store' },
        ...(admission.cookie ? { cookies: [admission.cookie] } : {}),
      });
    }
    if (
      admission.public &&
      (await liveMicrovm(config, api))?.state !== 'RUNNING'
    )
      return plain(
        responseStream,
        from,
        503,
        'The preview is not running. Open it with a sign-in first.\n',
      );
    let response;
    const method = event.requestContext?.http?.method ?? 'GET';
    const attempts = REPEATABLE_METHODS.has(method) ? 2 : 1;
    for (let attempt = 0; attempt < attempts && !response; attempt++) {
      try {
        const { url, init } = upstreamRequest(
          event,
          await current(!admission.public),
          config.routes,
        );
        response = await fetchImpl(url, init);
      } catch (error) {
        console.error(error);
        connection = undefined;
      }
    }
    if (!response)
      return plain(
        responseStream,
        from,
        503,
        'The preview is starting or unavailable. Reload in a moment.\n',
      );
    const stream = open(from, responseStream, responseMetadata(response));
    if (response.body) await pipeline(Readable.fromWeb(response.body), stream);
    else stream.end();
  };
}

export const handler = globalThis.awslambda?.streamifyResponse(
  (() => {
    let respond;
    return (event, responseStream) => {
      if (!respond) {
        const config = settings();
        respond = createProxy({
          config,
          api: microvms(config),
          from: (stream, metadata) =>
            globalThis.awslambda.HttpResponseStream.from(stream, metadata),
        });
      }
      return respond(event, responseStream);
    };
  })(),
);
