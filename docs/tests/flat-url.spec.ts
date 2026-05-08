// Legacy flat URL deprecation regression suite.
//
// PR #159 migrated recipe URLs from flat (`/repro/<slug>/`) to
// hierarchical (`/repro/<project>/<issue>/`). The intent is that the
// flat shape is **gone** — production deploy (`deploy-docs.yml`)
// only emits `doc_build/repro/<project>/<issue_path>/`, and the dev
// middleware (`docs/rspress.config.ts`) returns null for legacy flat
// slug lookups so the dev-time response also 404s.
//
// This suite locks the deprecation in. A future refactor that
// re-introduces a flat-slug fallback (or accidentally generates a
// flat URL into the build output) will turn these cases red.
//
// Tested against `bunx rspress preview`, which serves
// `docs/doc_build/`. If the build output never carried flat URLs,
// the preview server returns 404 for them — which is what we assert.

import { expect, test } from '@playwright/test';

const LEGACY_FLAT_URLS = [
  '/vivarium/repro/regex-779/',
  '/vivarium/repro/regex-779/repro.js',
  '/vivarium/repro/regex-779/repro.wasm',
  '/vivarium/repro/regex-779/repro.highlighted.html',
  '/vivarium/repro/pandas-56679/',
  '/vivarium/repro/numpy-28287/repro.js',
];

test.describe('docs site — legacy flat URLs are deprecated (404)', () => {
  for (const url of LEGACY_FLAT_URLS) {
    test(`legacy flat URL ${url} returns 404`, async ({ request }) => {
      // Use the API client so navigation-loop side effects (rspress
      // SPA shell loading partial chunks for missing routes) don't
      // confuse the assertion. We only care about the HTTP status.
      const response = await request.get(url);
      expect(
        response.status(),
        `legacy flat URL ${url} must 404 (deprecated by PR #159 in favour of /repro/<project>/<issue>/)`,
      ).toBe(404);
    });
  }

  test('canonical hierarchical URL still 200 (sanity check)', async ({
    request,
  }) => {
    const response = await request.get('/vivarium/repro/regex/779/');
    expect(response.status()).toBe(200);
  });
});
