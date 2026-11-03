import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { DEPLOYED_SHAPE_BASE } from '../playwright.config';

const SLUG = 'jj-10189';
const PAGE_PATH = 'repro/jj/10189/';
const PAGES = {
  en: `${DEPLOYED_SHAPE_BASE}/vivarium/${PAGE_PATH}`,
} as const;
const RECIPE_DIR = resolve(import.meta.dirname, '..', SLUG);
const STAGED = resolve(RECIPE_DIR, '_formicarium', 'assets.json');
const VERDICT_TIMEOUT_MS = 300_000;
const PINNED = 'JJ_TIMESTAMP=2001-02-03T04:05:06+07:00';
const COMMANDS = [
  `${PINNED} jj git init`,
  `${PINNED} jj new -m B`,
  `${PINNED} jj describe @- -m NEW`,
  `${PINNED} jj undo`,
];
const RETRY_COMMAND = `${PINNED} jj describe @- -m NEW`;

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
  serviceWorker: string | null;
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
  `${SLUG} is not staged: stage it with stage-formicarium-assets.ts to run this spec`,
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function observe(page: Page): Promise<Observed> {
  return page.evaluate(() => {
    const store = globalThis as unknown as {
      __VIVARIUM_RESULT__?: Envelope;
      __VIVARIUM_FORMICARIUM_MARKS__?: Observed['marks'];
    };
    return {
      verdict:
        document.getElementById('verdict')?.getAttribute('data-verdict') ??
        null,
      envelope: store.__VIVARIUM_RESULT__,
      isolated: globalThis.crossOriginIsolated === true,
      serviceWorker: navigator.serviceWorker.controller?.scriptURL ?? null,
      marks: store.__VIVARIUM_FORMICARIUM_MARKS__ ?? [],
      terminals: [...document.querySelectorAll('formicarium-terminal')].map(
        (terminal) => ({
          state: (terminal as HTMLElement).dataset['state'],
          status:
            terminal.querySelector('.vh-progress__label')?.textContent ?? '',
          transcript:
            (terminal as HTMLElement & { transcript?: string }).transcript ??
            '',
        }),
      ),
    };
  });
}

async function settle(page: Page, url: string): Promise<number> {
  const started = Date.now();
  await page.goto(url);
  await expect(page.locator('#verdict')).toHaveAttribute(
    'data-verdict',
    /^(reproduced|unreproduced)$/,
    { timeout: VERDICT_TIMEOUT_MS },
  );
  return Date.now() - started;
}

test('en: both terminals start isolated, verify and run the recorded commands', async ({
  page,
  browser,
  browserName,
}, testInfo) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const elapsedMs = await settle(page, PAGES.en);
  const observed = await observe(page);
  await testInfo.attach(`terminal-${browserName}-en.json`, {
    contentType: 'application/json',
    body: JSON.stringify(
      {
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
  expect(observed.serviceWorker).toMatch(/\/coi-serviceworker\.js$/);
  expect(observed.envelope?.runtime.name).toBe('formicarium');
  expect(observed.verdict).toBe('reproduced');
  expect(observed.envelope?.result.baseline_error).toBeNull();
  expect(observed.envelope?.result.fix_error).toBeNull();
  expect(observed.terminals.map((t) => t.state)).toEqual(['ready', 'ready']);
  expect(observed.terminals.map((t) => t.status)).toEqual(['Ready', 'Ready']);
  for (const terminal of observed.terminals)
    for (const command of COMMANDS)
      expect(terminal.transcript).toContain(`$ ${command}\n`);
  const [baselineTerminal, fixTerminal] = observed.terminals;
  expect(baselineTerminal?.transcript).toMatch(
    new RegExp(
      `\\$ ${escape(RETRY_COMMAND)}\\n[^$]*Newly-created commit [0-9a-f]{40} already exists\\n[^$]*$`,
    ),
  );
  expect(fixTerminal?.transcript).toMatch(
    new RegExp(
      `\\$ ${escape(RETRY_COMMAND)}\\n[^$]*Parent commit \\(@-\\)\\s*: \\S+ [0-9a-f]+ \\(empty\\) NEW\\n[^$]*$`,
    ),
  );
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

test('en: a changed ELF is not run and the page says why', async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(360_000);
  const elf = resolve(RECIPE_DIR, 'guests', 'fix', 'jj');
  const original = readFileSync(elf);
  const changed = Buffer.from(original);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 0xff;
  writeFileSync(elf, changed);
  try {
    await settle(page, PAGES.en);
    const observed = await observe(page);
    await testInfo.attach(`terminal-${browserName}-changed-elf.json`, {
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

test('en: a visitor types a command into the terminal', async ({
  page,
  browserName,
}) => {
  test.setTimeout(360_000);
  await settle(page, PAGES.en);
  const baseline = page.locator('#output-baseline formicarium-terminal');
  const rows = baseline.locator('.xterm-rows > div');
  await expect(rows.filter({ hasText: /^\$\s*$/ })).toHaveCount(1, {
    timeout: 30_000,
  });
  await baseline.locator('.xterm-screen').click();
  await page.keyboard.type('lsx');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      baseline.evaluate(
        (terminal) =>
          (terminal as HTMLElement & { transcript: string }).transcript,
      ),
    )
    .toMatch(/\$ ls\n\.git\/\n\.jj\/\n$/);
  await expect(rows.filter({ hasText: /^\$ ls\s*$/ })).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect(rows.filter({ hasText: /^\$ ls\s*$/ })).toHaveCount(2);
});

test('en: without xterm.js the terminal falls back to text and an input', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'only Chromium lets Playwright route the requests the coi service worker makes',
  );
  test.setTimeout(360_000);
  await page
    .context()
    .route('https://cdn.jsdelivr.net/npm/@xterm/**', (route) => route.abort());
  await settle(page, PAGES.en);
  const baseline = page.locator('#output-baseline formicarium-terminal');
  await expect(baseline.locator('.xterm')).toHaveCount(0);
  await expect(baseline.locator('.vh-terminal__plain')).toContainText(
    `$ ${COMMANDS[0]}`,
  );
  const input = baseline.locator('.vh-terminal__plain-input');
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.fill('ls');
  await input.press('Enter');
  await expect(baseline.locator('.vh-terminal__plain')).toContainText(
    '$ ls\n.git/\n.jj/',
  );
});
