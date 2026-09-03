#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAYER1_DIR = dirname(SCRIPT_DIR);
const REPO_ROOT = dirname(dirname(LAYER1_DIR));

const SKIP_DIRS = new Set([
  'node_modules',
  'scripts',
  'tests',
  'playwright-report',
  'test-results',
  'blob-report',
]);

function looksLikeRecipe(name: string): boolean {
  if (name.startsWith('_') || name.startsWith('.')) return false;
  if (SKIP_DIRS.has(name)) return false;
  return true;
}

interface CheckFailure {
  slug: string;
  path: string;
  reason: string;
  remedy: string;
}

const failures: CheckFailure[] = [];

function check(
  slug: string,
  path: string,
  body: string,
  needle: string | RegExp,
  reason: string,
  remedy: string,
): void {
  const matched =
    typeof needle === 'string' ? body.includes(needle) : needle.test(body);
  if (!matched) {
    failures.push({
      slug,
      path: relative(REPO_ROOT, path),
      reason,
      remedy,
    });
  }
}

const slugs = readdirSync(LAYER1_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && looksLikeRecipe(e.name))
  .map((e) => e.name)
  .sort();

const REQUIRED_MARKUP: ReadonlyArray<readonly [string, string]> = [
  [
    'vh-output-multi',
    'the output column is missing the `vh-output-multi` class, so the two panes fall back to the single-output grid chrome.js applies, and collapse.',
  ],
  [
    'data-variant="baseline"',
    'the baseline header/stage is missing its `data-variant="baseline"` marker.',
  ],
  [
    'vh-variant-stage',
    'the baseline `<pre>` is not wrapped in `.vh-variant-stage`, so the loading overlay chrome.js injects pushes the fix pane down the page instead of covering the pane it belongs to.',
  ],
  [
    'data-variant="fix-candidate"',
    'the fix-candidate header is missing its `data-variant="fix-candidate"` marker.',
  ],
  [
    'id="output-fix"',
    '`<pre id="output-fix">` is missing — there is nowhere to render the fix-candidate output.',
  ],
];

const RETIRED_MARKUP: ReadonlyArray<readonly [string, string]> = [
  ['data-i18n="section.output.h2"', 'section.output.h2'],
  ['data-i18n="output.placeholder"', 'output.placeholder'],
];

let recipesChecked = 0;
for (const slug of slugs) {
  const recipeDir = join(LAYER1_DIR, slug);
  const indexPath = join(recipeDir, 'index.html');
  const reproTsPath = join(recipeDir, 'repro.ts');

  if (!existsSync(indexPath)) continue;
  recipesChecked++;

  const indexBody = readFileSync(indexPath, 'utf-8');
  for (const [needle, reason] of REQUIRED_MARKUP) {
    check(
      slug,
      indexPath,
      indexBody,
      needle,
      reason,
      'Copy the output section from src/layer1_wasm/dateutil-1478/index.html — the two-pane block is identical in every recipe.',
    );
  }
  for (const [needle, key] of RETIRED_MARKUP) {
    if (indexBody.includes(needle)) {
      failures.push({
        slug,
        path: relative(REPO_ROOT, indexPath),
        reason: `\`${key}\` is a retired single-pane i18n key and must not appear.`,
        remedy:
          'Replace it with the two-pane keys (section.baseline.h2, output.pending, section.fix.h2) and update i18n.ja.json to match.',
      });
    }
  }

  if (!existsSync(reproTsPath)) {
    failures.push({
      slug,
      path: relative(REPO_ROOT, reproTsPath),
      reason: 'repro.ts is missing — every Layer 1 recipe must ship one.',
      remedy:
        'Author the recipe driver; see src/layer1_wasm/dateutil-1478/repro.ts for the dual-variant template.',
    });
    continue;
  }

  if (existsSync(join(recipeDir, 'fix-candidate.json'))) {
    const reproBody = readFileSync(reproTsPath, 'utf-8');
    const referencesManifest =
      reproBody.includes('./wheels/manifest.json') ||
      reproBody.includes('fetchWheelManifest');
    if (!referencesManifest) {
      failures.push({
        slug,
        path: relative(REPO_ROOT, reproTsPath),
        reason:
          'repro.ts neither calls `fetchWheelManifest` nor fetches `./wheels/manifest.json` — the fix-candidate wheel is never installed.',
        remedy:
          'Adopt the shared helper from `_shared/fix-candidate.ts` (dateutil-1478) or the inline fetch pattern (lark-1585).',
      });
    }
  }
}

if (failures.length === 0) {
  console.log(
    `[validate-output-panes] OK — ${recipesChecked} recipe(s) carry the baseline + fix-candidate output panes.`,
  );
  process.exit(0);
}

console.error(
  `[validate-output-panes] FAILED — ${failures.length} output-pane issue(s) across ${recipesChecked} recipe(s):\n`,
);
for (const f of failures) {
  console.error(`  ✗ ${f.slug} — ${f.path}`);
  console.error(`      ${f.reason}`);
  console.error(`      → ${f.remedy}\n`);
}
console.error(
  `Why this matters: a reproduction page earns its keep by showing the ` +
    `wrong result next to the right one. A page missing the second pane ` +
    `tells a visitor something is broken without telling them what ` +
    `"fixed" looks like — and a wheel the CI pipeline built but the page ` +
    `never installs is invisible, the regression behind PR #280.\n`,
);
process.exit(1);
