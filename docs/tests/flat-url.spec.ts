// Legacy flat-URL silent-breakage regression suite.
//
// PR #159 migrated recipe URLs from flat (`/repro/<slug>/`) to
// hierarchical (`/repro/<project>/<issue>/`). The migration left the
// rspress dev middleware (`docs/rspress.config.ts §builderConfig`)
// returning 200 for the parent HTML at the legacy URL (the single-
// segment fallback in resolveReproFile happens to match the recipe
// directory) but 404 for asset siblings under the same legacy URL,
// because resolveReproFile's multi-segment branch tried to split the
// slug as `<project>-<issue>`. The result was a silent breakage:
// the page rendered, but `repro.js` failed to load, chrome.js never
// injected, and the visitor saw `(running)` plain text.
//
// This suite hits the legacy URL shape end-to-end through the preview
// server. After the resolveReproFile fix in this PR (legacy flat-slug
// fallback in the multi-segment branch), the assets resolve and the
// page reaches its verdict. The suite keeps the fix honest: any
// future refactor that drops the fallback will turn this case red.
//
// Note: the production deploy serves these as plain static files
// (GH Actions copies `src/layer{1,2,3}_*/<slug>/` into
// `doc_build/repro/`), so legacy URLs work there even without the
// middleware fix. The fix matters only in dev. But the E2E suite
// runs against `bunx rspress preview`, which DOES serve the static
// build, so what we're really asserting is "the static build also
// includes the legacy URL shape under doc_build/repro/<slug>/" —
// which the build's layer-copy step already does today. This case
// guards against a future refactor that removes legacy paths from
// the build output.

import { expect, test } from '@playwright/test';

const LEGACY = '/vivarium/repro/regex-779/';

test.describe('recipe page — legacy flat URL', () => {
  test('legacy URL parent HTML is 200', async ({ page }) => {
    const response = await page.goto(LEGACY, { waitUntil: 'domcontentloaded' });
    expect(response, 'no response for legacy URL').not.toBeNull();
    expect(response!.status()).toBe(200);
  });

  test('legacy URL assets resolve and chrome.js injects', async ({ page }) => {
    // Track 503/404 on assets under the legacy URL — those are the
    // silent-breakage shape this fix addresses.
    const failedAssets: string[] = [];
    page.on('response', (resp) => {
      const url = resp.url();
      if (!url.includes('/repro/regex-779/')) return;
      if (resp.status() >= 400) {
        failedAssets.push(`${resp.status()} ${url}`);
      }
    });

    await page.goto(LEGACY, { waitUntil: 'domcontentloaded' });

    // Give chrome.js + the WASM loader a chance to run.
    await page.waitForSelector('.vh-topnav', { timeout: 10_000 });
    await page.waitForSelector(
      "#verdict[data-verdict='reproduced'], #verdict[data-verdict='unreproduced']",
      {
        timeout: 75_000,
      },
    );

    // No 4xx/5xx on any asset under the legacy URL.
    expect(
      failedAssets,
      'legacy URL assets must resolve cleanly (no 404/503)',
    ).toEqual([]);

    // chrome.js injected the top nav.
    await expect(page.locator('.vh-topnav').first()).toBeVisible();

    // Output reveal completed.
    await expect(page.locator('#output')).toHaveClass(/is-revealed/);
  });
});
