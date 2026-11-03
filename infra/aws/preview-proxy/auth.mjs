import { randomBytes } from 'node:crypto';

import { localPath, seal, unseal } from './session.mjs';

const STATE_COOKIE = 'vivarium-auth-state';
const STATE_MS = 10 * 60_000;
const TICKET_MS = 60_000;
const TICKET_PARAM = 'vivarium-ticket';
const GITHUB_API = {
  accept: 'application/vnd.github+json',
  'user-agent': 'vivarium-preview-auth',
  'x-github-api-version': '2022-11-28',
};

export function settings(env = process.env) {
  for (const name of ['SESSION_KEY', 'PREVIEWS_BUCKET', 'PREVIEWS_KEY'])
    if (!env[name]) throw new Error(`${name} is not set`);
  return {
    clientId: env.CLIENT_ID ?? '',
    clientSecret: env.CLIENT_SECRET ?? '',
    sessionKey: env.SESSION_KEY,
    previewsBucket: env.PREVIEWS_BUCKET,
    previewsKey: env.PREVIEWS_KEY,
  };
}

function refusal(preview, login) {
  if (!preview.pull)
    return [
      `This is Vivarium's live preview of ${preview.repository} at ${preview.commit}.`,
      'It lets in the maintainers Vivarium lists for the project and anyone added for this preview.',
      `You are signed in to GitHub as ${login}, who is not among them.`,
      'To be added, ask whoever shared this link with you.',
      '',
    ].join('\n');
  const pull = `https://github.com/${preview.repository}/pull/${preview.pull}`;
  return [
    `This is Vivarium's live preview of ${preview.repository}#${preview.pull}.`,
    "It lets in the pull request's author, the maintainers Vivarium lists for the project and anyone added for this pull request.",
    `You are signed in to GitHub as ${login}, who is not among them.`,
    `To be added, ask on the pull request: ${pull}`,
    '',
  ].join('\n');
}

function answer(statusCode, text, extra = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...extra.headers,
    },
    ...(extra.cookies ? { cookies: extra.cookies } : {}),
    body: text,
  };
}

const redirect = (location, cookies) =>
  answer(302, '', { headers: { location }, ...(cookies ? { cookies } : {}) });

function stateCookie(nonce, maxAge) {
  return `${STATE_COOKIE}=${nonce}; Path=/callback; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function ownCookie(cookies = []) {
  const prefix = `${STATE_COOKIE}=`;
  return cookies.find((c) => c.startsWith(prefix))?.slice(prefix.length);
}

export function admits(preview, login, author) {
  const wanted = login.toLowerCase();
  return [...preview.allowed, ...(author ? [author] : [])].some(
    (name) => name.toLowerCase() === wanted,
  );
}

export function createAuth({
  config,
  loadPreviews,
  fetchImpl = fetch,
  now = Date.now,
  nonce = () => randomBytes(16).toString('hex'),
}) {
  async function github(url, token) {
    const response = await fetchImpl(url, {
      headers: { ...GITHUB_API, authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
  }

  async function start(event, name, rest) {
    const preview = (await loadPreviews())[name];
    if (!preview) return answer(404, `There is no preview named ${name}.\n`);
    if (!config.clientId)
      return answer(503, 'Sign-in for the previews is not set up yet.\n');
    const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
    const id = nonce();
    const state = seal(config.sessionKey, {
      type: 'state',
      preview: name,
      path: `${localPath(rest)}${query}`,
      nonce: id,
      expires: now() + STATE_MS,
    });
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `https://${event.requestContext.domainName}/callback`,
      state,
      allow_signup: 'false',
    }).toString();
    return redirect(authorize.toString(), [stateCookie(id, STATE_MS / 1000)]);
  }

  async function callback(event) {
    const query = new URLSearchParams(event.rawQueryString ?? '');
    const state = unseal(config.sessionKey, query.get('state'), 'state', now());
    if (!state || state.nonce !== ownCookie(event.cookies))
      return answer(
        400,
        'This sign-in expired or was started elsewhere. Open the preview link again.\n',
      );
    const cleared = [stateCookie('', 0)];
    if (!query.get('code'))
      return answer(403, 'GitHub did not sign you in.\n', { cookies: cleared });
    const exchange = await fetchImpl(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: query.get('code'),
          redirect_uri: `https://${event.requestContext.domainName}/callback`,
        }),
      },
    );
    const token = exchange.ok
      ? (await exchange.json()).access_token
      : undefined;
    if (!token)
      return answer(502, 'GitHub did not complete the sign-in.\n', {
        cookies: cleared,
      });
    const { login } = await github('https://api.github.com/user', token);
    const preview = (await loadPreviews())[state.preview];
    if (!preview)
      return answer(404, `There is no preview named ${state.preview}.\n`, {
        cookies: cleared,
      });
    const author =
      admits(preview, login) || !preview.pull
        ? undefined
        : await github(
            `https://api.github.com/repos/${preview.repository}/pulls/${preview.pull}`,
            token,
          ).then(
            (pull) => pull.user?.login,
            (error) => console.error(error),
          );
    if (!admits(preview, login, author)) {
      console.log(`refused ${login} for ${state.preview}`);
      return answer(403, refusal(preview, login), { cookies: cleared });
    }
    console.log(`admitted ${login} to ${state.preview}`);
    const ticket = seal(config.sessionKey, {
      type: 'ticket',
      preview: state.preview,
      login,
      expires: now() + TICKET_MS,
    });
    const separator = state.path.includes('?') ? '&' : '?';
    return redirect(
      `${preview.url.replace(/\/+$/, '')}${state.path}${separator}${TICKET_PARAM}=${encodeURIComponent(ticket)}`,
      cleared,
    );
  }

  return async function respond(event) {
    const path = event.rawPath ?? '/';
    if (path === '/callback')
      try {
        return await callback(event);
      } catch (error) {
        console.error(error);
        return answer(502, 'The sign-in failed. Try again in a moment.\n', {
          cookies: [stateCookie('', 0)],
        });
      }
    const [, name, ...rest] = path.split('/');
    if (!name) return answer(404, 'Open a preview from its recipe page.\n');
    return start(event, name, rest.join('/'));
  };
}

async function readPreviews(config) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const object = await new S3Client({}).send(
    new GetObjectCommand({
      Bucket: config.previewsBucket,
      Key: config.previewsKey,
    }),
  );
  return JSON.parse(await object.Body.transformToString());
}

let respond;
export async function handler(event) {
  if (!respond) {
    const config = settings();
    respond = createAuth({ config, loadPreviews: () => readPreviews(config) });
  }
  return respond(event);
}
