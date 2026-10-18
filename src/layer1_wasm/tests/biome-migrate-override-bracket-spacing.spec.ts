import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { DEPLOYED_SHAPE_BASE } from '../playwright.config';

const SLUG = 'biome-migrate-override-bracket-spacing';
const PAGE_PATH = 'repro/biome/migrate-override-bracket-spacing/';
const PAGES = {
  en: `${DEPLOYED_SHAPE_BASE}/vivarium/${PAGE_PATH}`,
  ja: `${DEPLOYED_SHAPE_BASE}/vivarium/ja/${PAGE_PATH}`,
} as const;
const RECIPE_DIR = resolve(import.meta.dirname, '..', SLUG);
const STAGED = resolve(RECIPE_DIR, '_formicarium', 'assets.json');
const VERDICT_TIMEOUT_MS = 120_000;
const COMMANDS = [
  'cat .prettierrc',
  'cat biome.json',
  'biome migrate prettier --write',
  'cat biome.json',
];

interface Envelope {
  runtime: { name: string; version: string; extras: Record<string, string> };
  result: {
    baseline: unknown;
    fix_candidate: unknown;
    baseline_error: string | null;
    fix_error: string | null;
  };
}

interface Observed {
  verdict: string | null;
  envelope: Envelope | undefined;
  isolated: boolean;
  coepCredentialless: unknown;
  marks: { name: string; at: number; detail: Record<string, number> }[];
  terminals: {
    state: string | undefined;
    status: string;
    transcript: string;
  }[];
}

test.describe.configure({ retries: 0, mode: 'serial' });

test.skip(
  !existsSync(STAGED),
  `${SLUG} is not staged: it is pending until its guests are accepted and the formicarium pin exists; stage it with stage-formicarium-assets.ts to run this spec`,
);

async function observe(page: Page): Promise<Observed> {
  return page.evaluate(() => {
    const store = globalThis as unknown as {
      __VIVARIUM_RESULT__?: Envelope;
      __VIVARIUM_FORMICARIUM_MARKS__?: Observed['marks'];
      coi?: { coepCredentialless?: () => unknown };
    };
    return {
      verdict:
        document.getElementById('verdict')?.getAttribute('data-verdict') ??
        null,
      envelope: store.__VIVARIUM_RESULT__,
      isolated: globalThis.crossOriginIsolated === true,
      coepCredentialless: store.coi?.coepCredentialless?.(),
      marks: store.__VIVARIUM_FORMICARIUM_MARKS__ ?? [],
      terminals: [...document.querySelectorAll('formicarium-terminal')].map(
        (terminal) => ({
          state: (terminal as HTMLElement).dataset['state'],
          status:
            terminal.querySelector('.vh-terminal__status')?.textContent ?? '',
          transcript:
            terminal.querySelector('.vh-terminal__output')?.textContent ?? '',
        }),
      ),
    };
  });
}

const COVERAGE_DIR = process.env['U6_COVERAGE_DIR'] || undefined;

async function settle(
  page: Page,
  url: string,
  coverageName: string,
): Promise<number> {
  const collect =
    COVERAGE_DIR !== undefined && test.info().project.name === 'chromium';
  if (collect)
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
  const started = Date.now();
  await page.goto(url);
  await expect(page.locator('#verdict')).toHaveAttribute(
    'data-verdict',
    /^(reproduced|unreproduced)$/,
    { timeout: VERDICT_TIMEOUT_MS },
  );
  const elapsed = Date.now() - started;
  if (collect) {
    const entries = await page.coverage.stopJSCoverage();
    mkdirSync(COVERAGE_DIR, { recursive: true });
    writeFileSync(
      resolve(COVERAGE_DIR, `${coverageName}.json`),
      JSON.stringify(
        entries.filter((entry) =>
          /\/(_shared\/formicarium_terminal|biome\/migrate-override-bracket-spacing\/)/.test(
            entry.url,
          ),
        ),
      ),
    );
  }
  return elapsed;
}

for (const lang of ['en', 'ja'] as const) {
  test(`${lang}: both terminals start isolated, verify and run the recorded commands`, async ({
    page,
    browser,
    browserName,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const elapsedMs = await settle(page, PAGES[lang], `${browserName}-${lang}`);
    const observed = await observe(page);
    await testInfo.attach(`u6-${browserName}-${lang}.json`, {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          lang,
          browser: browserName,
          browserVersion: browser.version(),
          os: `${platform()} ${release()} ${arch()}`,
          elapsedMs,
          verdict: observed.verdict,
          baselineError: observed.envelope?.result.baseline_error ?? null,
          fixError: observed.envelope?.result.fix_error ?? null,
          marks: observed.marks,
          consoleErrors: errors,
        },
        null,
        2,
      ),
    });
    expect(observed.isolated).toBe(true);
    expect(observed.coepCredentialless).toBe(false);
    expect(observed.envelope?.runtime.name).toBe('formicarium');
    expect(observed.terminals.map((t) => t.state)).toEqual(['ready', 'ready']);
    for (const terminal of observed.terminals)
      for (const command of COMMANDS)
        expect(terminal.transcript).toContain(`$ ${command}\n`);
    const names = observed.marks.map((mark) => mark.name);
    for (const name of [
      'isolated',
      'fetch.baseline.end',
      'verify.baseline.end',
      'ready.baseline',
      'ready.fix',
      'verdict',
    ])
      expect(names).toContain(name);
  });
}

test('en: a changed ELF is not run and the page says why', async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  const elf = resolve(RECIPE_DIR, 'guests', 'fix', 'biome');
  const original = readFileSync(elf);
  const changed = Buffer.from(original);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 0xff;
  writeFileSync(elf, changed);
  try {
    await settle(page, PAGES.en, `${browserName}-changed-elf`);
    const observed = await observe(page);
    await testInfo.attach(`u6-${browserName}-changed-elf.json`, {
      contentType: 'application/json',
      body: JSON.stringify(observed.terminals, null, 2),
    });
    const [baseline, fix] = observed.terminals;
    expect(baseline?.state).toBe('ready');
    expect(fix?.state).toBe('failed');
    expect(fix?.status).toMatch(/^Failed: .+/);
    expect(fix?.transcript).toBe('');
    expect(observed.envelope?.result.fix_candidate).toBeNull();
    expect(observed.envelope?.result.fix_error ?? '').not.toBe('');
  } finally {
    writeFileSync(elf, original);
  }
});
