// Catalogue fetcher tests. Uses Bun's built-in test runner with
// `bun:test` globals and a stubbed global fetch — no network access
// in CI.
//
// Coverage focus: TTL behaviour, network-failure fallback to bundled
// snapshot, malformed-response rejection.

import { afterEach, beforeEach, describe, it } from 'bun:test';
import { strict as assert } from 'node:assert';

import {
  _resetCacheForTesting,
  fetchVerdictSnapshot,
  getBundledIndex,
  getCatalogue,
  INDEX_URL,
} from '../src/catalogue.ts';

type FetchMock = (input: string | URL | Request, init?: RequestInit) =>
  Promise<Response>;

const realFetch = globalThis.fetch;

function mockFetch(handler: FetchMock): void {
  globalThis.fetch = handler as typeof globalThis.fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

describe('catalogue', () => {
  beforeEach(() => {
    _resetCacheForTesting();
  });
  afterEach(() => {
    restoreFetch();
    _resetCacheForTesting();
  });

  it('returns parsed v1 payload on a successful fetch', async () => {
    mockFetch(async (input) => {
      assert.equal(String(input), INDEX_URL);
      return new Response(
        JSON.stringify({
          index: 'v1',
          contract: 'v1',
          recipes: [
            {
              slug: 'pandas-56679',
              layer: 1,
              project: 'pandas',
              issue: 56679,
              title: 'pandas-dev/pandas#56679',
              page_url: 'https://example.invalid/repro/pandas-56679/',
              source_url: 'https://example.invalid/src/pandas-56679',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const idx = await getCatalogue();
    assert.equal(idx.index, 'v1');
    assert.equal(idx.recipes.length, 1);
    assert.equal(idx.recipes[0]!.slug, 'pandas-56679');
  });

  it('falls back to the bundled snapshot on network failure', async () => {
    mockFetch(async () => {
      throw new TypeError('network fail');
    });
    const idx = await getCatalogue();
    const bundled = getBundledIndex();
    assert.equal(idx.index, bundled.index);
    assert.equal(idx.recipes.length, bundled.recipes.length);
  });

  it('falls back to the bundled snapshot on non-200', async () => {
    mockFetch(
      async () =>
        new Response('not found', { status: 404 }),
    );
    const idx = await getCatalogue();
    assert.equal(idx.index, getBundledIndex().index);
  });

  it('rejects a malformed payload (wrong index literal)', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ index: 'v999', contract: 'v1', recipes: [] }),
          { status: 200 },
        ),
    );
    const idx = await getCatalogue();
    // Wrong literal → fall through to bundled.
    assert.equal(idx.index, getBundledIndex().index);
  });

  it('caches within TTL', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ index: 'v1', contract: 'v1', recipes: [] }),
        { status: 200 },
      );
    });
    await getCatalogue();
    await getCatalogue();
    await getCatalogue();
    assert.equal(calls, 1);
  });

  it('returns null verdict snapshot on non-v1 payload', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ contract: 'v999', verdict: 'pass' }),
          { status: 200 },
        ),
    );
    const snap = await fetchVerdictSnapshot('https://example.invalid/v.json');
    assert.equal(snap, null);
  });
});
