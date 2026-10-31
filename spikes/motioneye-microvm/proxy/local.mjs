import { createServer } from 'node:http';

import { createProxy } from './index.mjs';

const upstream = process.env.UPSTREAM ?? 'http://127.0.0.1:18765';
const port = Number(process.env.PORT ?? 18080);
const accessKey = process.env.ACCESS_KEY ?? 'local';

const api = {
  list: async () => ({ items: [{ microvmId: 'local', state: 'RUNNING' }] }),
  get: async () => ({ microvmId: 'local', state: 'RUNNING', endpoint: 'local' }),
  run: async () => {
    throw new Error('no MicroVM is started locally');
  },
  token: async () => ({ authToken: { 'X-aws-proxy-auth': 'local' } }),
};

const fetchImpl = (url, init) =>
  fetch(url.replace('https://local', upstream), init);

function from(res, { statusCode, headers = {}, cookies = [] }) {
  res.writeHead(statusCode, {
    ...headers,
    ...(cookies.length ? { 'set-cookie': cookies } : {}),
  });
  return res;
}

const respond = createProxy({
  config: { accessKey, tokenMinutes: 60 },
  api,
  fetchImpl,
  from,
});

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const url = new URL(req.url, 'http://localhost');
  const headers = {};
  for (const [name, value] of Object.entries(req.headers))
    if (name !== 'cookie') headers[name] = String(value);
  await respond(
    {
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      cookies: req.headers.cookie?.split(/;\s*/) ?? [],
      headers,
      requestContext: { http: { method: req.method } },
      body: chunks.length ? Buffer.concat(chunks).toString('base64') : undefined,
      isBase64Encoded: true,
    },
    res,
  );
}).listen(port, () => console.log(`proxy on http://127.0.0.1:${port}/?vivarium-key=${accessKey}`));
