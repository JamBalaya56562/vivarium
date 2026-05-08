// Docs-site smoke suite.
//
// For each tracked page under `docs/docs/{en,ja}/`, asserts:
//   1. HTTP 200 — the page actually loads from the rspress preview
//      server without a 404 or 500.
//   2. Non-empty <title> — rspress emits the frontmatter title (or
//      first markdown h1) into <title> at SSR time. An empty title
//      was the silent regression shape on a previous PR (rspress
//      component swap left frontmatter unprojected).
//   3. SSR HTML contains an `<h1` tag — every rspress page, whether
//      a doc-layout page, a project landing page, or the site
//      landing, ships at least one `<h1>` in its static HTML. We
//      assert against the *response body* (not the post-hydration
//      DOM) because rspress v2's client-side hydration transiently
//      unmounts and re-mounts page-level components; a DOM-level
//      `count('h1')` check sees 0 during that window on at least
//      one engine and went flaky across runs. Reading the SSR HTML
//      via `response.text()` skips the hydration window entirely.
//
// Why no `<main>` / `<header>` / `<footer>` assertions?
//   Their presence varies by page shape: landing pages mount a
//   custom `<Page>` chrome (`<article class="v-land-layer">`) with
//   no `<main>`; doc pages render `<main class="rp-doc-layout__...">`;
//   `themeConfig.footer.message` renders only on landings. Asserting
//   any one of them site-wide produces false negatives. <title> +
//   `<h1` in SSR HTML are the two surfaces that hold for every
//   page shape on every engine.
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
      expect(
        title.trim().length,
        `empty <title> on ${page.url}`,
      ).toBeGreaterThan(0);

      // `<h1` in raw SSR HTML — read directly from the response body
      // so the assertion is independent of any client-side hydration
      // window. Every rspress page ships at least one <h1> in its
      // static HTML; an empty match means the page rendered as a
      // blank shell (the "silent regression" smoke is meant to
      // catch).
      const html = await response!.text();
      expect(html, `no <h1> in SSR HTML for ${page.url}`).toMatch(/<h1[\s>]/);
    });
  }
});
