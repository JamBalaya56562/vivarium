import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const metadata = JSON.parse(
  readFileSync(new URL('../biome-12265/recipe.json', import.meta.url), 'utf-8'),
) as {
  fix_candidate: { commit: string };
};

for (const locale of ['en', 'ja']) {
  test(`Biome Prettier migration compares exact source builds (${locale})`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const url =
      locale === 'en'
        ? 'http://localhost:8767/biome-12265/'
        : 'http://localhost:8769/vivarium/ja/repro/biome/12265/';
    await page.goto(url);
    await expect(page.locator('#verdict')).toHaveAttribute(
      'data-verdict',
      'reproduced',
      { timeout: 120_000 },
    );
    await expect(page.locator('#output-fix')).toHaveAttribute(
      'data-fix-status',
      'ok',
      { timeout: 120_000 },
    );
    const result = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __VIVARIUM_RESULT__: { result: Record<string, unknown> };
          }
        ).__VIVARIUM_RESULT__.result,
    );
    expect(result).toMatchObject({
      baseline_error: null,
      fix_error: null,
      baseline: {
        ref: 'migrate-prettier-before',
        commit: '2405c7620169bd0719166af09a8d89cc76fb37fb',
        input: { prettier: {}, biome: {} },
        commands: [
          { command: 'cat .prettierrc', code: 0 },
          { command: 'cat biome.json', code: 0 },
          { command: 'biome migrate prettier --write', code: 0 },
          { command: 'cat biome.json', code: 0 },
        ],
        configuration: {
          javascript: {
            formatter: { semicolons: 'asNeeded', quoteStyle: 'single' },
          },
        },
        reproduced: true,
        corrected: false,
      },
      fix_candidate: {
        ref: 'migrate-prettier-after',
        commit: metadata.fix_candidate.commit,
        input: { prettier: {}, biome: {} },
        commands: [
          { command: 'cat .prettierrc', code: 0 },
          { command: 'cat biome.json', code: 0 },
          { command: 'biome migrate prettier --write', code: 0 },
          { command: 'cat biome.json', code: 0 },
        ],
        configuration: {
          javascript: {
            formatter: { semicolons: 'always', quoteStyle: 'double' },
          },
        },
        reproduced: false,
        corrected: true,
      },
    });
    for (const selector of ['#output-baseline', '#output-fix']) {
      const transcript = await page
        .locator(`${selector} terrarium-terminal`)
        .evaluate(
          (terminal) =>
            (terminal as HTMLElement & { transcript: string }).transcript,
        );
      expect(transcript).toContain('quoteStyle');
    }
  });
}
