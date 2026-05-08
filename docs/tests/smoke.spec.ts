// Docs-site smoke suite.
//
// For each tracked page under `docs/docs/{en,ja}/`, asserts:
//   1. HTTP 200 — the page actually loads from the rspress preview
//      server without a 404 or 500.
//   2. Non-empty <h1> — every page has a visible heading; an empty
//      heading was the silent regression shape on a previous PR
//      (rspress component swap left the page rendering with no h1
//      content because a JSX prop name changed).
//   3. Top nav (`<header>` element) is present at least once.
//      rspress v2 emits a `<header class="rp-nav">`; we match by
//      semantic element so the test survives a class-name refactor.
//
// Footer assertion intentionally omitted: rspress v2's
// `themeConfig.footer.message` only renders on the landing page;
// doc pages and pages that mount a custom `<Page>` chrome (which
// supplies its own `<BottomNote>` instead of the theme footer) do
// not render an "Apache" footer string. A site-wide assertion
// would therefore be false-negative on most of the catalogue. The
// landing-page footer is covered separately when V′ adds visual
// regression coverage; smoke stays narrow to "the page rendered
// at all and has its heading + nav."
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

      // Top nav as a semantic <header>. rspress's nav is a <header>
      // element regardless of which class-name iteration the theme
      // uses. We require at least one to exist; visibility check is
      // skipped because some viewports collapse the nav into a
      // hamburger that hides the header content but keeps the
      // element rendered.
      const headerCount = await pw.locator('header').count();
      expect(headerCount, `no <header> on ${page.url}`).toBeGreaterThan(0);
    });
  }
});
