// Docs-site smoke suite.
//
// For each tracked page under `docs/docs/{en,ja}/`, asserts:
//   1. HTTP 200 — the page actually loads from the static deploy
//      (preview server) without a 404 or 500.
//   2. Non-empty <h1> — every page has a visible heading; an empty
//      heading was the silent regression shape on a previous PR
//      (rspress component swap left the page rendering with no h1
//      content because a JSX prop name changed).
//   3. Top nav (rspress's `.rspress-nav` or our shared `.vh-topnav`
//      injected by chrome.js on recipe pages) is present.
//   4. Footer line is present.
//
// The page list is enumerated from disk (`tests/_helpers/pages.ts`),
// so new pages added to `docs/docs/{en,ja}/` automatically join the
// smoke suite without a test edit. This is the "silent breakage
// safety net" the user asked for: any future PR that accidentally
// breaks page X's render gets caught here even if the PR's own
// test plan only mentioned page Y.

import { expect, test } from '@playwright/test';
import { ALL_PAGES } from './_helpers/pages';

test.describe.configure({ mode: 'default' });

test.describe('docs site — page smoke', () => {
  for (const page of ALL_PAGES) {
    test(`${page.lang.toUpperCase()} ${page.rel}`, async ({ page: pw }) => {
      const response = await pw.goto(page.url, {
        waitUntil: 'domcontentloaded',
      });
      expect(response, `no response for ${page.url}`).not.toBeNull();
      expect(response!.status(), `status for ${page.url}`).toBe(200);

      // h1 — rspress renders the frontmatter `title` (or first markdown
      // h1) as a real <h1>. We don't pin its text because the i18n
      // suite covers EN/JA contrast; smoke just asserts non-empty.
      const h1Count = await pw.locator('h1').count();
      expect(h1Count, `no h1 on ${page.url}`).toBeGreaterThan(0);
      const h1Text = (await pw.locator('h1').first().textContent()) ?? '';
      expect(h1Text.trim().length, `empty h1 on ${page.url}`).toBeGreaterThan(
        0,
      );

      // rspress's nav. The class name is `.rspress-nav` (rspress v2),
      // present on every doc page. Recipe pages live at /repro/<...>/
      // index URLs that are also rspress-rendered, so this check
      // applies uniformly.
      const navCount = await pw.locator('.rspress-nav').count();
      expect(navCount, `no nav on ${page.url}`).toBeGreaterThan(0);

      // Footer — rspress uses the themeConfig.footer.message; the
      // string contains "Apache License 2.0" on every locale.
      const footerLocator = pw.locator('footer', { hasText: 'Apache' });
      await expect(
        footerLocator.first(),
        `no Apache footer on ${page.url}`,
      ).toBeVisible();
    });
  }
});
