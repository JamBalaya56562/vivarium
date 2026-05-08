// Docs-site smoke suite.
//
// For each tracked page under `docs/docs/{en,ja}/`, asserts:
//   1. HTTP 200 — the page actually loads from the rspress preview
//      server without a 404 or 500.
//   2. Non-empty <title> — rspress emits the frontmatter title (or
//      first markdown h1) into <title> at SSR time. An empty title
//      was the silent regression shape on a previous PR (rspress
//      component swap left frontmatter unprojected). Source:
//      rspress's static HTML head; immune to SPA hydration timing.
//   3. <main> element present — rspress's theme renders a single
//      <main> per page. Same SSR property as <title>; not subject
//      to hydration race.
//
// Why not assert <h1> / <header> directly?
//   The static HTML rspress builds DOES contain <h1>/<header>
//   elements, but rspress v2's client-side hydration replaces some
//   page-level components after the React tree mounts, and on JA-
//   locale routes the replacement window is wider than CI's
//   reasonable wait budget on at least one engine (WebKit on
//   Linux). Asserting `count > 0` against the post-hydration DOM
//   thus produced flaky results across engines. <title> + <main>
//   both come from rspress's SSR pipeline and are stable for every
//   tested page on every engine — the smoke contract holds without
//   chasing the hydration race.
//
// Footer assertion intentionally omitted: rspress v2's
// `themeConfig.footer.message` only renders on the landing page;
// doc pages and pages that mount a custom `<Page>` chrome do not
// render an "Apache" footer string. The landing-page footer is
// covered separately when V′ adds visual regression coverage.
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

      // <title> from frontmatter — rspress projects this into the
      // HTML head at SSR time, so it is present the moment the
      // response body finishes parsing (no hydration race). An empty
      // <title> means rspress's frontmatter projection broke.
      const title = await pw.title();
      expect(title.trim().length, `empty <title> on ${page.url}`).toBeGreaterThan(
        0,
      );

      // <main> — rspress's theme emits exactly one <main> in every
      // page's static HTML. Same SSR-stable property as <title>: no
      // dependency on client-side hydration. Catches the "page
      // rendered as a blank shell" regression.
      const mainCount = await pw.locator('main').count();
      expect(mainCount, `no <main> on ${page.url}`).toBeGreaterThan(0);
    });
  }
});
