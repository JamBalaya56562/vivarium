import { describe, expect, test } from 'bun:test';
import { BuildError } from '../src/errors.ts';
import { type Fetcher, fetchLimited } from '../src/http.ts';
import { findPublished, releaseTag } from '../src/reuse.ts';
import { assetsOf, SOURCE, sampleSet } from './helpers/artifacts.ts';

async function errorCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

function server(routes: Record<string, () => Response>): {
  fetcher: Fetcher;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const route = routes[url];
      return route === undefined
        ? new Response('missing', { status: 404 })
        : route();
    },
  };
}

describe('fetchLimited', () => {
  test('follows checked redirects without credentials and counts bytes on the stream', async () => {
    const { fetcher, calls } = server({
      'https://a.example/x': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://b.example/y' },
        }),
      'https://b.example/y': () =>
        new Response('12345', { headers: { 'content-length': '1' } }),
    });
    const result = await fetchLimited('https://a.example/x', {
      limitBytes: 5,
      fetcher,
    });
    expect(new TextDecoder().decode(result.bytes)).toBe('12345');
    expect(result.finalUrl).toBe('https://b.example/y');
    expect(
      calls.every(
        (call) =>
          call.init.credentials === 'omit' && call.init.redirect === 'manual',
      ),
    ).toBe(true);
    expect(
      await errorCode(
        fetchLimited('https://b.example/y', { limitBytes: 4, fetcher }),
      ),
    ).toBe('LIMIT_EXCEEDED');
  });

  test('refuses http, credentials, a sixth redirect, a loop and HTTP errors', async () => {
    const hops: Record<string, () => Response> = {};
    for (let i = 0; i < 6; i += 1)
      hops[`https://h.example/${i}`] = () =>
        new Response(null, {
          status: 301,
          headers: { location: `https://h.example/${i + 1}` },
        });
    hops['https://h.example/6'] = () => new Response('ok');
    const { fetcher } = server({
      ...hops,
      'https://loop.example/a': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://loop.example/a' },
        }),
      'https://down.example/': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://down.example/' },
        }),
      'https://err.example/': () => new Response('no', { status: 500 }),
    });
    expect(
      await errorCode(
        fetchLimited('http://x.example/', { limitBytes: 1, fetcher }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(
        fetchLimited('https://u:p@x.example/', { limitBytes: 1, fetcher }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(
        fetchLimited('https://h.example/0', { limitBytes: 10, fetcher }),
      ),
    ).toBe('EXTERNAL');
    expect(
      await errorCode(
        fetchLimited('https://h.example/1', { limitBytes: 10, fetcher }),
      ),
    ).toBeUndefined();
    expect(
      await errorCode(
        fetchLimited('https://loop.example/a', { limitBytes: 10, fetcher }),
      ),
    ).toBe('EXTERNAL');
    expect(
      await errorCode(
        fetchLimited('https://down.example/', { limitBytes: 10, fetcher }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(
        fetchLimited('https://err.example/', { limitBytes: 10, fetcher }),
      ),
    ).toBe('EXTERNAL');
  });
});

describe('findPublished', () => {
  function published(set = sampleSet(), assets?: string[], draft = false) {
    const tag = releaseTag('biome', set.key);
    const base = `https://github.com/aletheia-works/vivarium/releases/download/${tag}`;
    return server({
      [`https://api.github.com/repos/aletheia-works/vivarium/releases/tags/${tag}`]:
        () =>
          Response.json({
            draft,
            assets: (assets ?? Object.keys(assetsOf(set.files))).map(
              (name) => ({ name }),
            ),
          }),
      ...Object.fromEntries(
        Object.entries(assetsOf(set.files)).map(([name, bytes]) => [
          `${base}/${name}`,
          () => new Response(bytes as Uint8Array<ArrayBuffer>),
        ]),
      ),
    });
  }

  test('reuses a verified published set without compiling', async () => {
    const set = sampleSet();
    const { fetcher } = published(set);
    const result = await findPublished({
      tool: 'biome',
      binary: 'biome',
      key: set.key,
      source: SOURCE,
      fetcher,
    });
    expect(result?.compiled).toBe(false);
    expect(result?.elfSha256).toBe(result?.buildInfo.elfSha256 as string);
  });

  test('returns null when no published Release exists, so the caller compiles', async () => {
    const set = sampleSet();
    const { fetcher } = server({});
    expect(
      await findPublished({
        tool: 'biome',
        binary: 'biome',
        key: set.key,
        source: SOURCE,
        fetcher,
      }),
    ).toBeNull();
  });

  test('does not count a draft as published', async () => {
    const set = sampleSet();
    const { fetcher } = published(set, undefined, true);
    expect(
      await findPublished({
        tool: 'biome',
        binary: 'biome',
        key: set.key,
        source: SOURCE,
        fetcher,
      }),
    ).toBeNull();
  });

  test('marks the key unusable when the published set is incomplete or fails verification', async () => {
    const set = sampleSet();
    const incomplete = published(set, ['biome', 'build-info.json']);
    expect(
      await errorCode(
        findPublished({
          tool: 'biome',
          binary: 'biome',
          key: set.key,
          source: SOURCE,
          fetcher: incomplete.fetcher,
        }),
      ),
    ).toBe('UNUSABLE_KEY');
    const threeFiles = published(set, [
      'biome',
      'build-info.json',
      'catalog.json',
    ]);
    expect(
      await errorCode(
        findPublished({
          tool: 'biome',
          binary: 'biome',
          key: set.key,
          source: SOURCE,
          fetcher: threeFiles.fetcher,
        }),
      ),
    ).toBe('UNUSABLE_KEY');
    const otherNotices = published({
      ...set,
      files: { ...set.files, notices: new TextEncoder().encode('changed') },
    });
    expect(
      await errorCode(
        findPublished({
          tool: 'biome',
          binary: 'biome',
          key: set.key,
          source: SOURCE,
          fetcher: otherNotices.fetcher,
        }),
      ),
    ).toBe('UNUSABLE_KEY');
    const tampered = published({
      ...set,
      files: {
        ...set.files,
        elf: new TextEncoder().encode('\x7fELF-tampered'),
      },
    });
    expect(
      await errorCode(
        findPublished({
          tool: 'biome',
          binary: 'biome',
          key: set.key,
          source: SOURCE,
          fetcher: tampered.fetcher,
        }),
      ),
    ).toBe('UNUSABLE_KEY');
  });

  test('needs the full key for the tag', () => {
    expect(() => releaseTag('biome', 'abc')).toThrow(BuildError);
    expect(releaseTag('biome', 'a'.repeat(64))).toBe(
      `guest-biome-${'a'.repeat(64)}`,
    );
  });
});

describe('fetchLimited failures', () => {
  test('reports a connection failure through the default fetch as EXTERNAL', async () => {
    expect(
      await errorCode(fetchLimited('https://127.0.0.1:1/', { limitBytes: 1 })),
    ).toBe('EXTERNAL');
  });

  test('reports a cancelled fetch as ABORTED and refuses an invalid limit', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher: Fetcher = async (_url, init) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response('x');
    };
    expect(
      await errorCode(
        fetchLimited('https://a.example/', {
          limitBytes: 1,
          fetcher,
          signal: controller.signal,
        }),
      ),
    ).toBe('ABORTED');
    expect(
      await errorCode(
        fetchLimited('https://a.example/', { limitBytes: -1, fetcher }),
      ),
    ).toBe('INVALID_INPUT');
  });

  test('refuses bytes whose SHA256 differs from the expected one', async () => {
    const fetcher: Fetcher = async () => new Response('abc');
    expect(
      await errorCode(
        fetchLimited('https://a.example/', {
          limitBytes: 10,
          fetcher,
          expectedSha256: '0'.repeat(64),
        }),
      ),
    ).toBe('VERIFY_FAILED');
  });
});
