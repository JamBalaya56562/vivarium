import assert from 'node:assert/strict';
import { test } from 'node:test';

import { admits, createAuth, settings } from './auth.mjs';
import { seal, unseal } from './session.mjs';

const NOW = Date.parse('2026-11-01T09:00:00Z');
const CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  sessionKey: 'open-sesame',
  signInUrl: 'https://sign-in.example',
  previews: {
    'motioneye-1': {
      url: 'https://preview.example/',
      repository: 'owner/repo',
      pull: 1,
      allowed: ['Maintainer'],
    },
  },
};

function github({ login = 'maintainer', author = 'someone' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push([url, init.headers?.authorization]);
    if (url === 'https://github.com/login/oauth/access_token')
      return Response.json({ access_token: 'user-token' });
    if (url === 'https://api.github.com/user') return Response.json({ login });
    if (url === 'https://api.github.com/repos/owner/repo/pulls/1')
      return Response.json({ user: { login: author } });
    return new Response('not found', { status: 404 });
  };
  return { calls, fetchImpl };
}

function auth(fetchImpl, config = CONFIG) {
  return createAuth({
    config,
    fetchImpl,
    now: () => NOW,
    nonce: () => 'nonce-1',
  });
}

async function signIn(respond, path = '/motioneye-1/config', query = '') {
  const start = await respond({
    rawPath: path,
    rawQueryString: query,
  });
  const state = new URL(start.headers.location).searchParams.get('state');
  return respond({
    rawPath: '/callback',
    rawQueryString: `code=abc&state=${encodeURIComponent(state)}`,
    cookies: [start.cookies[0].split(';')[0]],
  });
}

test('settings refuses a missing session key', () => {
  assert.throws(
    () => settings({ PREVIEWS: '{}', SIGN_IN_URL: 'https://a' }),
    /SESSION_KEY is not set/,
  );
});

test('settings reads the previews and the sign-in URL', () => {
  const config = settings({
    SESSION_KEY: 'a',
    PREVIEWS: '{"motioneye-1":{"allowed":[]}}',
    SIGN_IN_URL: 'https://sign-in.example/',
  });
  assert.deepEqual(config.previews, { 'motioneye-1': { allowed: [] } });
  assert.equal(config.signInUrl, 'https://sign-in.example');
});

test('opening a preview sends the browser to GitHub with a state bound to a cookie', async () => {
  const { calls, fetchImpl } = github();
  const response = await auth(fetchImpl)({
    rawPath: '/motioneye-1/config',
    rawQueryString: 'a=1',
  });
  assert.equal(response.statusCode, 302);
  const location = new URL(response.headers.location);
  assert.equal(
    location.origin + location.pathname,
    'https://github.com/login/oauth/authorize',
  );
  assert.equal(location.searchParams.get('client_id'), 'client-id');
  assert.equal(
    location.searchParams.get('redirect_uri'),
    'https://sign-in.example/callback',
  );
  assert.equal(location.searchParams.get('allow_signup'), 'false');
  assert.equal(location.searchParams.get('scope'), null);
  const state = unseal(
    'open-sesame',
    location.searchParams.get('state'),
    'state',
    NOW,
  );
  assert.equal(state.preview, 'motioneye-1');
  assert.equal(state.path, '/config?a=1');
  assert.match(
    response.cookies[0],
    /^__Host-vivarium-auth-state=nonce-1; Path=\/; Max-Age=600; HttpOnly; Secure/,
  );
  assert.deepEqual(calls, []);
});

test('an unknown preview, the root and a missing client id get no sign-in', async () => {
  const { fetchImpl } = github();
  const respond = auth(fetchImpl);
  assert.equal((await respond({ rawPath: '/motioneye-9/' })).statusCode, 404);
  assert.equal((await respond({ rawPath: '/' })).statusCode, 404);
  assert.equal(
    (
      await auth(fetchImpl, { ...CONFIG, clientId: '' })({
        rawPath: '/motioneye-1/',
      })
    ).statusCode,
    503,
  );
});

test('a listed login gets a ticket for that preview, without asking for the pull request', async () => {
  const { calls, fetchImpl } = github({ login: 'MAINTAINER' });
  const response = await signIn(auth(fetchImpl), '/motioneye-1/config', 'a=1');
  assert.equal(response.statusCode, 302);
  const location = new URL(response.headers.location);
  assert.equal(
    location.origin + location.pathname,
    'https://preview.example/config',
  );
  assert.equal(location.searchParams.get('a'), '1');
  const ticket = unseal(
    'open-sesame',
    location.searchParams.get('vivarium-ticket'),
    'ticket',
    NOW,
  );
  assert.deepEqual(ticket, {
    type: 'ticket',
    preview: 'motioneye-1',
    login: 'MAINTAINER',
    expires: NOW + 60_000,
  });
  assert.match(
    response.cookies[0],
    /^__Host-vivarium-auth-state=; .*Max-Age=0/,
  );
  assert.deepEqual(
    calls.map(([url]) => url),
    [
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
    ],
  );
  assert.equal(calls[1][1], 'Bearer user-token');
});

test("the pull request's author is admitted and anyone else refused", async () => {
  const author = github({ login: 'someone', author: 'Someone' });
  const admitted = await signIn(auth(author.fetchImpl));
  assert.equal(admitted.statusCode, 302);
  assert.equal(
    author.calls.at(-1)[0],
    'https://api.github.com/repos/owner/repo/pulls/1',
  );
  const stranger = github({ login: 'stranger' });
  const refused = await signIn(auth(stranger.fetchImpl));
  assert.equal(refused.statusCode, 403);
  assert.match(refused.body, /live preview of owner\/repo#1\./);
  assert.match(refused.body, /signed in to GitHub as stranger, who is not/);
  assert.match(refused.body, /https:\/\/github\.com\/owner\/repo\/pull\/1$/m);
  assert.equal(refused.headers.location, undefined);
});

test('a preview without a pull request admits only its list and never asks for an author', async () => {
  const previews = {
    'motioneye-dev': {
      url: 'https://preview.example/',
      repository: 'owner/repo',
      pull: null,
      commit: '7b7ab1c97ff7c89e55f615826aec835a6269c7aa',
      allowed: ['Maintainer'],
    },
  };
  const respond = (fetchImpl) =>
    createAuth({
      config: { ...CONFIG, previews },
      fetchImpl,
      now: () => NOW,
      nonce: () => 'nonce-1',
    });
  const listed = github({ login: 'maintainer' });
  assert.equal(
    (await signIn(respond(listed.fetchImpl), '/motioneye-dev/')).statusCode,
    302,
  );
  const stranger = github({ login: 'stranger' });
  const refused = await signIn(respond(stranger.fetchImpl), '/motioneye-dev/');
  assert.equal(refused.statusCode, 403);
  assert.match(
    refused.body,
    /live preview of owner\/repo at 7b7ab1c97ff7c89e55f615826aec835a6269c7aa\./,
  );
  assert.match(refused.body, /signed in to GitHub as stranger, who is not/);
  assert.doesNotMatch(refused.body, /pull/);
  assert.deepEqual(
    stranger.calls.map(([url]) => url),
    [
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
    ],
  );
});

test('a callback without its cookie, with a forged or expired state is refused before GitHub is asked', async () => {
  const { calls, fetchImpl } = github();
  const respond = auth(fetchImpl);
  const state = (overrides = {}) =>
    seal('open-sesame', {
      type: 'state',
      preview: 'motioneye-1',
      path: '/',
      nonce: 'nonce-1',
      expires: NOW + 60_000,
      ...overrides,
    });
  const callback = (token, cookies) =>
    respond({
      rawPath: '/callback',
      rawQueryString: `code=abc&state=${encodeURIComponent(token)}`,
      cookies,
    });
  const cookie = ['__Host-vivarium-auth-state=nonce-1'];
  assert.equal((await callback(state(), [])).statusCode, 400);
  assert.equal(
    (await callback(state(), ['__Host-vivarium-auth-state=other'])).statusCode,
    400,
  );
  assert.equal(
    (await callback(state({ expires: NOW }), cookie)).statusCode,
    400,
  );
  assert.equal(
    (await callback(state({ type: 'ticket' }), cookie)).statusCode,
    400,
  );
  assert.equal(
    (await callback(`${state().split('.')[0]}.forged`, cookie)).statusCode,
    400,
  );
  assert.deepEqual(calls, []);
});

test('a failed lookup of the author refuses a stranger with 403', async () => {
  const { fetchImpl } = github({ login: 'stranger' });
  const respond = auth(async (url, init) =>
    url.includes('/pulls/')
      ? new Response('rate limited', { status: 403 })
      : fetchImpl(url, init),
  );
  const response = await signIn(respond);
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /signed in to GitHub as stranger/);
});

test('a GitHub failure answers 502 and clears the state cookie', async () => {
  const respond = auth(async () => new Response('down', { status: 500 }));
  const response = await signIn(respond);
  assert.equal(response.statusCode, 502);
  assert.match(response.cookies[0], /Max-Age=0/);
});

test('admits compares logins without case', () => {
  assert.equal(admits(CONFIG.previews['motioneye-1'], 'maintainer'), true);
  assert.equal(
    admits(CONFIG.previews['motioneye-1'], 'author', 'AUTHOR'),
    true,
  );
  assert.equal(
    admits(CONFIG.previews['motioneye-1'], 'other', 'author'),
    false,
  );
});
