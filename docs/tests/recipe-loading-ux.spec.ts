// Recipe-page loading-UX regression suite.
//
// Asserts the loading-UX surface that `_assets/chrome.js` injects on
// every recipe page:
//   1. Top nav (`.vh-topnav`) is present (chrome.js injectChrome ran).
//   2. Output section gets `.vh-output-section` class and `<pre id="output">`
//      gets `.vh-output` (the swap-zone CSS in `_shared/style.css`).
//   3. While the WASM runtime is loading, `.vh-progress` is in the DOM
//      with non-zero opacity — i.e. the teal→violet gradient bar is
//      visible to the visitor, not the bare "(running)" plain text.
//   4. After the run completes, `.vh-output.is-revealed` and the
//      verdict resolves to `reproduced` (matches the recipe-regression
//      suite under src/layer1_wasm/tests, but framed from the docs-
//      site preview server so the rspress middleware path is in scope).
//
// Why this case lives in the docs E2E suite (and not the existing
// Layer 1 regression suite): the layer-1 suite serves the recipe
// directly from a Python `http.server` rooted at `src/layer1_wasm/`,
// which bypasses the rspress middleware entirely. The docs E2E suite
// goes through the rspress preview server (production-shape), so the
// progress-bar regression that motivated this PR — chrome.js never
// injecting because the page was reached via a flat URL whose assets
// 404'd silently — is only catchable here.

import { expect, type Page, test } from '@playwright/test';

const HIERARCHICAL = '/vivarium/repro/regex/779/';

async function waitForReproductionVerdict(page: Page): Promise<void> {
  // Verdict pill carries the data-verdict attribute that flips from
  // "pending" to "reproduced" / "unreproduced" when the run finishes.
  await page.waitForSelector(
    "#verdict[data-verdict='reproduced'], #verdict[data-verdict='unreproduced']",
    {
      timeout: 75_000,
    },
  );
}

test.describe('recipe page — loading UX (hierarchical URL)', () => {
  test('regex/779 loads with chrome.js injection + progress bar visible during load', async ({
    page,
  }) => {
    await page.goto(HIERARCHICAL, { waitUntil: 'domcontentloaded' });

    // chrome.js injectChrome sets .vh-topnav at the start of <body>.
    await expect(page.locator('.vh-topnav').first()).toBeVisible({
      timeout: 5_000,
    });

    // The output section gets .vh-output-section and #output gets
    // .vh-output. Both should be true by the time chrome.js's
    // injectChrome() returns, which is before any verdict resolves.
    await expect(page.locator('.vh-output-section').first()).toBeAttached({
      timeout: 5_000,
    });
    const outputEl = page.locator('#output');
    await expect(outputEl).toHaveClass(/(?:^|\s)vh-output(?:\s|$)/);

    // Progress bar element exists and is not yet faded (no .is-done).
    // Captured before the run completes; chrome.js removes it after
    // a 600 ms cross-fade.
    const progress = page.locator('.vh-progress');
    await expect(progress.first()).toBeAttached({ timeout: 5_000 });

    // Verdict resolves to reproduced (regex-779 reproduces the bug
    // reliably on Rust wasm32-wasip1).
    await waitForReproductionVerdict(page);
    await expect(page.locator('#verdict')).toHaveAttribute(
      'data-verdict',
      'reproduced',
    );

    // After completion, .vh-output.is-revealed indicates the cross-
    // fade landed on the output panel.
    await expect(outputEl).toHaveClass(/is-revealed/);

    // The output content is the JSON envelope, not the placeholder.
    const outputText = (await outputEl.textContent()) ?? '';
    expect(outputText).toContain('matches_plus');
    expect(outputText).toContain('matches_expanded');
  });

  test('recipe page exposes contract v1 surface (meta + globals)', async ({
    page,
  }) => {
    await page.goto(HIERARCHICAL, { waitUntil: 'domcontentloaded' });
    await waitForReproductionVerdict(page);

    const metaContract = page.locator('meta[name="vivarium-contract"]');
    await expect(metaContract).toHaveAttribute('content', 'v1');

    const globals = await page.evaluate(() => ({
      verdict: (globalThis as Record<string, unknown>).__VIVARIUM_VERDICT__,
      result: (globalThis as Record<string, unknown>).__VIVARIUM_RESULT__,
    }));
    expect(globals.verdict).toBe('reproduced');
    expect(globals.result).toBeTruthy();
  });
});
