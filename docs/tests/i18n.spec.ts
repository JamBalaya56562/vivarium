// i18n switcher and EN ↔ JA symmetry suite.
//
// Asserts:
//   1. Every EN page tracked under `docs/docs/en/` has a sibling under
//      `docs/docs/ja/`, and vice versa. ADR-0028 §"i18n Definition of
//      Done" mandates EN+JA same-PR; this case turns that policy into
//      a CI failure when it's accidentally violated.
//   2. The locale switcher in rspress's nav round-trips between EN
//      and JA on representative pages. A regression where the
//      switcher links to /vivarium/ja/ (no JA root locale config) or
//      drops the path entirely is the kind of silent breakage that
//      escapes manual review.
//
// Symmetry is asserted as a single test (not per-page) because the
// failure mode is "a page exists in one locale but not the other" —
// the diff message is most useful when listed all at once.

import { expect, test } from '@playwright/test';
import { ALL_PAGES, I18N_BELLWETHERS, partnerUrl } from './_helpers/pages';

test.describe('docs site — EN ↔ JA file symmetry', () => {
  test('every EN page has a JA sibling and vice versa', () => {
    const enRels = new Set(
      ALL_PAGES.filter((p) => p.lang === 'en').map((p) => p.rel),
    );
    const jaRels = new Set(
      ALL_PAGES.filter((p) => p.lang === 'ja').map((p) => p.rel),
    );
    const enOnly = [...enRels].filter((r) => !jaRels.has(r)).sort();
    const jaOnly = [...jaRels].filter((r) => !enRels.has(r)).sort();
    expect(
      { enOnly, jaOnly },
      'EN/JA tree is asymmetric — every page must ship with both locales (ADR-0028 §i18n DoD).',
    ).toEqual({ enOnly: [], jaOnly: [] });
  });
});

test.describe('docs site — locale switcher round-trips', () => {
  for (const enUrl of I18N_BELLWETHERS) {
    test(`${enUrl} → JA via switcher → ${enUrl} round-trip`, async ({
      page,
    }) => {
      // Open the EN page and click the locale switcher. rspress
      // renders the switcher as `<a>` elements inside the nav with
      // text "日本語" or "English"; we pick whichever the current
      // page exposes.
      const jaUrl = partnerUrl(enUrl);

      await page.goto(enUrl, { waitUntil: 'domcontentloaded' });
      // Switcher to JA — a literal "日本語" link in the nav.
      const toJa = page.locator('a', { hasText: '日本語' }).first();
      await expect(toJa, `no 日本語 switcher on ${enUrl}`).toBeVisible();
      await toJa.click();
      await page.waitForURL((url) => url.pathname === jaUrl, {
        timeout: 15_000,
      });
      expect(page.url(), `JA URL after click on ${enUrl}`).toContain(jaUrl);

      // Round-trip: switcher back to EN.
      const toEn = page.locator('a', { hasText: 'English' }).first();
      await expect(toEn, `no English switcher on ${jaUrl}`).toBeVisible();
      await toEn.click();
      await page.waitForURL((url) => url.pathname === enUrl, {
        timeout: 15_000,
      });
      expect(page.url(), `EN URL after click on ${jaUrl}`).toContain(enUrl);
    });
  }
});
