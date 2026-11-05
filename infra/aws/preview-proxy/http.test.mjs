import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { createHandler, head, toEvent } from './http.mjs';

async function server(respond, run, maxBodyBytes) {
  const instance = createServer(createHandler(respond, maxBodyBytes));
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${instance.address().port}`);
  } finally {
    instance.close();
  }
}

test('toEvent keeps the path and query as sent, splits the cookies and encodes the body', async () => {
  const request = Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]);
  Object.assign(request, {
    url: '/a%20b/../c?x=1&y=2?z',
    method: 'POST',
    headers: { cookie: 'one=1; two=2', authorization: 'Bearer key' },
  });
  const event = await toEvent(request);
  assert.equal(event.rawPath, '/a%20b/../c');
  assert.equal(event.rawQueryString, 'x=1&y=2?z');
  assert.deepEqual(event.cookies, ['one=1', 'two=2']);
  assert.equal(event.headers.authorization, 'Bearer key');
  assert.equal(event.requestContext.http.method, 'POST');
  assert.equal(event.isBase64Encoded, true);
  assert.equal(Buffer.from(event.body, 'base64').toString(), '{"a":1}');
});

test('a request without a body or cookies has neither', async () => {
  const request = Readable.from([]);
  Object.assign(request, { url: '/', method: 'GET', headers: {} });
  const event = await toEvent(request);
  assert.equal(event.rawQueryString, '');
  assert.deepEqual(event.cookies, []);
  assert.equal(event.body, undefined);
});

test('the server answers with the status, headers, every cookie and a streamed body', async () => {
  await server(
    (event, response) => {
      const stream = head(response, {
        statusCode: 201,
        headers: { 'content-type': 'text/plain' },
        cookies: ['one=1', 'two=2'],
      });
      stream.write(Buffer.from(event.body, 'base64'));
      stream.end('!');
    },
    async (url) => {
      const response = await fetch(`${url}/`, { method: 'POST', body: 'hi' });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('content-type'), 'text/plain');
      assert.deepEqual(response.headers.getSetCookie(), ['one=1', 'two=2']);
      assert.equal(await response.text(), 'hi!');
    },
  );
});

test('a 304 and a HEAD write nothing and still finish', async () => {
  await server(
    (event, response) => {
      const stream = head(response, {
        statusCode: event.rawPath === '/304' ? 304 : 200,
      });
      stream.write('');
      stream.end();
    },
    async (url) => {
      assert.equal((await fetch(`${url}/304`)).status, 304);
      assert.equal((await fetch(`${url}/`, { method: 'HEAD' })).status, 200);
    },
  );
});

test('a failure before the answer is a 502, not a hung request', async (t) => {
  t.mock.method(console, 'error', () => {});
  await server(
    () => {
      throw new Error('boom');
    },
    async (url) => {
      assert.equal((await fetch(url)).status, 502);
    },
  );
});

test('a body over the limit reads to its end and gets 413 without reaching the handler', async () => {
  let reached = false;
  await server(
    () => {
      reached = true;
    },
    async (url) => {
      const response = await fetch(url, { method: 'POST', body: '12345' });
      assert.equal(response.status, 413);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(await response.text(), /larger than a preview accepts/);
    },
    4,
  );
  assert.equal(reached, false);
});

test('a body at the limit reaches the handler', async () => {
  await server(
    (event, response) => {
      head(response, { statusCode: 200 }).end(
        Buffer.from(event.body, 'base64'),
      );
    },
    async (url) => {
      const response = await fetch(url, { method: 'POST', body: '1234' });
      assert.equal(await response.text(), '1234');
    },
    4,
  );
});
