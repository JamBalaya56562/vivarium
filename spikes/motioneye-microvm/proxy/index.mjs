import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const API_VERSION = '2025-09-09';
const MOTIONEYE_PORT = 8765;
const LIVE_STATES = new Set(['PENDING', 'RUNNING', 'SUSPENDING', 'SUSPENDED']);
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 1_000;
const TOKEN_MARGIN_MS = 60_000;
const COOKIE = 'vivarium-preview';
const KEY_PARAM = 'vivarium-key';
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
  for (const name of ['IMAGE_ARN', 'INGRESS_CONNECTOR', 'ACCESS_KEY'])
    if (!env[name]) throw new Error(`${name} is not set`);
  return {
    region: env.AWS_REGION,
    imageArn: env.IMAGE_ARN,
    ingressConnector: env.INGRESS_CONNECTOR,
    accessKey: env.ACCESS_KEY,
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
    token: (id, body) =>
      call('POST', `/microvms/${encodeURIComponent(id)}/auth-token`, { body }),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function previewMicrovm(config, api, { now = Date.now } = {}) {
  let nextToken;
  do {
    const page = await api.list(config.imageArn, nextToken);
    const live = (page.items ?? []).find((item) => LIVE_STATES.has(item.state));
    if (live) return api.get(live.microvmId);
    nextToken = page.nextToken;
  } while (nextToken);
  let microvm = await api.run({
    imageIdentifier: config.imageArn,
    ingressNetworkConnectors: [config.ingressConnector],
    idlePolicy: config.idlePolicy,
    maximumDurationInSeconds: config.maximumDurationInSeconds,
    clientToken: `preview-${new Date(now())
      .toISOString()
      .slice(0, 16)
      .replace(/\D/g, '')}`,
  });
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
    allowedPorts: [{ port: MOTIONEYE_PORT }],
  });
  const token = authToken?.['X-aws-proxy-auth'];
  if (!token) throw new Error('Lambda returned no token');
  return {
    endpoint: microvm.endpoint,
    token,
    expiresAt: now() + config.tokenMinutes * 60_000,
  };
}

const cookieValue = (accessKey) =>
  createHmac('sha256', accessKey).update(COOKIE).digest('hex');

function sameSecret(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function ownCookie(cookies = []) {
  const prefix = `${COOKIE}=`;
  return cookies.find((c) => c.startsWith(prefix))?.slice(prefix.length);
}

export function admit(config, event) {
  const query = new URLSearchParams(event.rawQueryString ?? '');
  const key = query.get(KEY_PARAM);
  if (key !== null) {
    if (!sameSecret(key, config.accessKey)) return { status: 403 };
    query.delete(KEY_PARAM);
    const rest = query.toString();
    return {
      status: 302,
      location: `${event.rawPath || '/'}${rest ? `?${rest}` : ''}`,
      cookie: `${COOKIE}=${cookieValue(config.accessKey)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
    };
  }
  const cookie = ownCookie(event.cookies);
  if (cookie && sameSecret(cookie, cookieValue(config.accessKey)))
    return { status: 200 };
  return { status: 403 };
}

export function upstreamRequest(event, connection) {
  const headers = {};
  for (const [name, value] of Object.entries(event.headers ?? {}))
    if (!DROPPED_REQUEST_HEADERS.has(name) && !name.startsWith('x-amzn-'))
      headers[name] = value;
  const cookies = (event.cookies ?? []).filter(
    (c) => !c.startsWith(`${COOKIE}=`),
  );
  if (cookies.length) headers.cookie = cookies.join('; ');
  headers['x-aws-proxy-auth'] = connection.token;
  headers['x-aws-proxy-port'] = String(MOTIONEYE_PORT);
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

function plain(responseStream, from, statusCode, text, extra = {}) {
  const stream = from(responseStream, {
    statusCode,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    ...extra,
  });
  stream.end(text);
}

export function createProxy({ config, api, fetchImpl = fetch, from, now = Date.now }) {
  let connection;
  async function current() {
    if (!connection || connection.expiresAt - TOKEN_MARGIN_MS < now())
      connection = await connect(config, api, { now });
    return connection;
  }
  return async function respond(event, responseStream) {
    const admission = admit(config, event);
    if (admission.status === 403)
      return plain(responseStream, from, 403, 'This preview needs the link with its key.\n');
    if (admission.status === 302)
      return plain(responseStream, from, 302, '', {
        headers: { location: admission.location, 'cache-control': 'no-store' },
        cookies: [admission.cookie],
      });
    let response;
    for (let attempt = 0; attempt < 2 && !response; attempt++) {
      try {
        const { url, init } = upstreamRequest(event, await current());
        response = await fetchImpl(url, init);
      } catch (error) {
        console.error(error);
        connection = undefined;
      }
    }
    if (!response)
      return plain(responseStream, from, 503, 'The preview is starting or unavailable. Reload in a moment.\n');
    const stream = from(responseStream, responseMetadata(response));
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
