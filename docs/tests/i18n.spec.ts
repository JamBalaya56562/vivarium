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

      const jaResponse = await request.get(jaUrl);
      expect(jaResponse.status(), `JA URL ${jaUrl}`).toBe(200);

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
