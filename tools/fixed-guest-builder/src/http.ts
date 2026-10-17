import { createHash } from 'node:crypto';
import { fail } from './errors.ts';

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const MAX_REDIRECTS = 5;

export const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

export interface LimitedFetchOptions {
  limitBytes: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  expectedSha256?: string;
}

export interface LimitedFetchResult {
  bytes: Uint8Array;
  sha256: string;
  finalUrl: string;
}

function checkUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_INPUT', 'fetch URL is not absolute');
  }
  if (url.protocol !== 'https:')
    fail('INVALID_INPUT', 'fetch URL must use https');
  if (url.username || url.password)
    fail('INVALID_INPUT', 'fetch URL must not carry credentials');
  return url;
}

export async function fetchLimited(
  start: string,
  options: LimitedFetchOptions,
): Promise<LimitedFetchResult> {
  if (!Number.isSafeInteger(options.limitBytes) || options.limitBytes < 0)
    fail('INVALID_INPUT', 'limitBytes must be a safe integer');
  const fetcher = options.fetcher ?? defaultFetcher;
  const seen = new Set<string>();
  let url = checkUrl(start);
  for (let hop = 0; ; hop += 1) {
    if (seen.has(url.href)) fail('EXTERNAL', 'redirect loop');
    seen.add(url.href);
    let response: Response;
    try {
      response = await fetcher(url.href, {
        redirect: 'manual',
        credentials: 'omit',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error) {
      if (options.signal?.aborted) fail('ABORTED', 'fetch was cancelled');
      fail(
        'EXTERNAL',
        `fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      if (hop >= MAX_REDIRECTS) fail('EXTERNAL', 'too many redirects');
      const location = response.headers.get('location');
      if (location === null) fail('EXTERNAL', 'redirect without a location');
      url = checkUrl(new URL(location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      fail('EXTERNAL', `fetch returned HTTP ${response.status}`);
    // Content-Length is not trusted; the limit is counted on the stream.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const hash = createHash('sha256');
    if (response.body !== null) {
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > options.limitBytes)
          fail(
            'LIMIT_EXCEEDED',
            `response is larger than ${options.limitBytes} bytes`,
          );
        hash.update(chunk);
        chunks.push(chunk);
      }
    }
    const sha256 = hash.digest('hex');
    if (
      options.expectedSha256 !== undefined &&
      sha256 !== options.expectedSha256
    )
      fail('VERIFY_FAILED', 'fetched bytes differ from the expected SHA256');
    return {
      bytes: new Uint8Array(Buffer.concat(chunks)),
      sha256,
      finalUrl: url.href,
    };
  }
}
