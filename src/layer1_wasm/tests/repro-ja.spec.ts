import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const JA_BASE = 'http://localhost:8769';

const SUPPORTED_VERDICTS = ['reproduced', 'unreproduced'] as const;
const SUPPORTED_RUNTIMES = [
  'pyodide',
  'ruby.wasm',
  'php-wasm',
  'rust-wasi',
] as const;

type ExpectedVerdict = (typeof SUPPORTED_VERDICTS)[number];
type ExpectedRuntimeName = (typeof SUPPORTED_RUNTIMES)[number];

interface RecipeEntry {
  slug: string;
  layer: 1 | 2 | 3;
  expected_verdict?: string;
  expected_runtime?: string;
  page_url_ja?: string;
}

interface RecipesIndex {
  recipes: RecipeEntry[];
}

interface JaCase {
  slug: string;
  url: string;
  expectedVerdict: ExpectedVerdict;
  expectedRuntimeName: ExpectedRuntimeName;
}

function isExpectedVerdict(value: unknown): value is ExpectedVerdict {
  return SUPPORTED_VERDICTS.some((v) => v === value);
}

function isExpectedRuntimeName(value: unknown): value is ExpectedRuntimeName {
  return SUPPORTED_RUNTIMES.some((v) => v === value);
}

function loadJaCases(): JaCase[] {
  const indexPath = resolve(
    import.meta.dirname,
    '../../..',
    'docs/site/public/api/recipes.json',
  );
  const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as RecipesIndex;
  return parsed.recipes
    .filter((r) => r.layer === 1 && typeof r.page_url_ja === 'string')
    .map((r) => {
      if (!isExpectedVerdict(r.expected_verdict)) {
        throw new Error(
          `${r.slug}: expected_verdict must be one of ${SUPPORTED_VERDICTS.join(', ')}`,
        );
      }
      if (!isExpectedRuntimeName(r.expected_runtime)) {
        throw new Error(
          `${r.slug}: expected_runtime must be one of ${SUPPORTED_RUNTIMES.join(', ')}`,
        );
      }
      return {
        slug: r.slug,
        url: `${JA_BASE}${new URL(r.page_url_ja as string).pathname}`,
        expectedVerdict: r.expected_verdict,
        expectedRuntimeName: r.expected_runtime,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function timeoutForRuntime(name: ExpectedRuntimeName): number {
  return name === 'pyodide' ? 120_000 : 75_000;
}

const cases = loadJaCases();

for (const c of cases) {
  test(`${c.slug} japanese page produces ${c.expectedVerdict}`, async ({
    page,
  }) => {
    test.setTimeout(timeoutForRuntime(c.expectedRuntimeName) + 15_000);

    const notFound: string[] = [];
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const { pathname } = new URL(response.url());
      if (!pathname.includes('/repro/')) return;
      notFound.push(`${response.status()} ${pathname}`);
    });

    await page.goto(c.url);

    const lang = await page.locator('html').getAttribute('lang');
    expect.soft(lang, 'html[lang]').toBe('ja');

    await page.waitForFunction(
      () => {
        const v = (
          globalThis as unknown as { __VIVARIUM_VERDICT__?: string }
        ).__VIVARIUM_VERDICT__;
        return v === 'reproduced' || v === 'unreproduced';
      },
      undefined,
      { timeout: timeoutForRuntime(c.expectedRuntimeName) },
    );

    const verdict = await page.evaluate(
      () =>
        (globalThis as unknown as { __VIVARIUM_VERDICT__?: string })
          .__VIVARIUM_VERDICT__,
    );
    expect.soft(verdict, 'japanese page verdict').toBe(c.expectedVerdict);

    const fixPane = page.locator('#output-fix');
    await expect.soft(fixPane, '#output-fix exists').toHaveCount(1);
    await expect
      .soft(fixPane, '#output-fix settled (not left pending)')
      .not.toHaveAttribute('data-fix-status', 'pending', { timeout: 60_000 });
    const fixText = ((await fixPane.textContent()) ?? '').trim();
    expect.soft(fixText.length, '#output-fix is non-empty').toBeGreaterThan(0);

    expect
      .soft(notFound, 'recipe assets that failed to load')
      .toStrictEqual([]);
  });
}
