import { createServer } from 'node:http';

export const MAX_BODY_BYTES = 64 * 1024 * 1024;

export async function toEvent(request, maxBodyBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  // Read to the end even past the limit: the platform delivers no answer before it has the whole request.
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= maxBodyBytes) chunks.push(chunk);
    else chunks.length = 0;
  }
  if (size > maxBodyBytes) return undefined;
  const [rawPath, ...query] = request.url.split('?');
  return {
    rawPath,
    rawQueryString: query.join('?'),
    headers: request.headers,
    cookies: request.headers.cookie?.split(/;\s*/) ?? [],
    requestContext: { http: { method: request.method } },
    ...(chunks.length
      ? {
          body: Buffer.concat(chunks).toString('base64'),
          isBase64Encoded: true,
        }
      : {}),
  };
}

export function head(response, { statusCode, headers = {}, cookies = [] }) {
  response.writeHead(statusCode, {
    ...headers,
    ...(cookies.length ? { 'set-cookie': cookies } : {}),
  });
  return response;
}

export function createHandler(respond, maxBodyBytes = MAX_BODY_BYTES) {
  return async (request, response) => {
    try {
      const event = await toEvent(request, maxBodyBytes);
      if (!event) {
        response.writeHead(413, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end('This request is larger than a preview accepts.\n');
        return;
      }
      await respond(event, response);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  };
}

export function listen(respond, env = process.env) {
  const [host, port] = env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');
  return createServer(createHandler(respond)).listen(Number(port), host);
}
