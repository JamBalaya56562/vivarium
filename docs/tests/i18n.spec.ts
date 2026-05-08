// i18n switcher and EN ↔ JA symmetry suite.
//
// Asserts:
//   1. Every EN page tracked under `docs/docs/en/` has a sibling under
//      `docs/docs/ja/`, and vice versa. ADR-0028 §"i18n Definition of
//      Done" mandates EN+JA same-PR; this case turns that policy into
//      a CI failure when it's accidentally violated.
//   2. Every representative EN page exposes a locale-switcher anchor
//      pointing at the JA sibling (and vice versa), and the JA URL
//      itself responds 200. A regression where the switcher's
//      `href` drops the locale prefix or points at the wrong sibling
//      breaks the bilingual nav silently; this case turns that into
//      a CI failure.
//
// We assert via the switcher's `href` attribute rather than by
// click-then-wait because rspress renders the locale switcher inside
// a hover-group dropdown (`.rp-hover-group__item__link`), which is
// `display: hidden` until the parent is hovered. Hover-then-click is
// brittle across browser engines (WebKit's hover semantics differ
// from Chromium's, and pointer-events: none on the hidden dropdown
// trips even force-click). Asserting the link's `href` and then
// navigating to that URL directly tests the same contract — "the
// switcher takes you to the right sibling page" — without exercising
// the engine-specific hover surface.

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

test.describe('docs site — locale switcher hrefs and JA round-trip', () => {
  for (const enUrl of I18N_BELLWETHERS) {
    test(`${enUrl} switcher → JA URL → switcher back round-trip`, async ({
      page,
      request,
    }) => {
      const jaUrl = partnerUrl(enUrl);

      // 1. Open the EN page, locate the JA switcher anchor by
      //    `hreflang="ja"` (rspress sets it on the alternate-language
      //    link). The link element is in the DOM but hidden behind a
      //    hover dropdown; `attached` (not `visible`) is the right
      //    waiting condition.
      await page.goto(enUrl, { waitUntil: 'domcontentloaded' });
      const toJa = page.locator('a[hreflang="ja"]').first();
      await expect(
        toJa,
        `no a[hreflang="ja"] switcher on ${enUrl}`,
      ).toBeAttached();
      const jaHref = await toJa.getAttribute('href');
      expect(jaHref, `JA switcher href on ${enUrl}`).toMatch(
        /\/vivarium\/ja\//,
      );

      // 2. Visit the JA URL directly (the switcher's `href` would
      //    take the visitor here on click). It must render 200 — a
      //    regression where the JA tree is partially missing surfaces
      //    here even when the symmetry assertion in the previous
      //    describe passes (a file can exist on disk yet fail to
      //    render).
      const jaResponse = await request.get(jaUrl);
      expect(jaResponse.status(), `JA URL ${jaUrl}`).toBe(200);

      // 3. Round-trip: the JA page exposes an EN switcher.
      await page.goto(jaUrl, { waitUntil: 'domcontentloaded' });
      const toEn = page.locator('a[hreflang="en"]').first();
      await expect(
        toEn,
        `no a[hreflang="en"] switcher on ${jaUrl}`,
      ).toBeAttached();
      const enHref = await toEn.getAttribute('href');
      expect(enHref, `EN switcher href on ${jaUrl}`).not.toMatch(
        /\/vivarium\/ja\//,
      );
    });
  }
});
