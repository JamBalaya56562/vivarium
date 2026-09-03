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

      const html = await response!.text();

      const titleMatch = html.match(/<title>([^<]*)<\/title>/);
      expect(
        titleMatch?.[1]?.trim()?.length ?? 0,
        `empty <title> in SSR HTML for ${page.url}`,
      ).toBeGreaterThan(0);

      expect(html, `no <h1> in SSR HTML for ${page.url}`).toMatch(/<h1[\s>]/);
    });
  }
});
