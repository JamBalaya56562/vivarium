import { createHmac, timingSafeEqual } from 'node:crypto';

const mac = (key, body) =>
  createHmac('sha256', key).update(body).digest('base64url');

export function seal(key, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(key, body)}`;
}

export function unseal(key, token, type, now = Date.now()) {
  const [body, signature, extra] = String(token ?? '').split('.');
  if (!body || !signature || extra !== undefined) return undefined;
  const expected = Buffer.from(mac(key, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return undefined;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (payload?.type !== type || !(payload.expires > now)) return undefined;
  return payload;
}

export function localPath(path) {
  return `/${String(path ?? '').replace(/^[/\\]+/, '')}`;
}
