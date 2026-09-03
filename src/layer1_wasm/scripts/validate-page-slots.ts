#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAYER1_DIR = dirname(SCRIPT_DIR);
const REPO_ROOT = dirname(dirname(LAYER1_DIR));
const LAYER2_DIR = join(REPO_ROOT, 'src', 'layer2_docker');

const SKIP_DIRS = new Set([
  'node_modules',
  'scripts',
  'tests',
  'playwright-report',
  'test-results',
  'blob-report',
]);

interface CheckFailure {
  slug: string;
  path: string;
  reason: string;
  remedy: string;
}

const failures: CheckFailure[] = [];

const LAYER1_SLOTS: ReadonlyArray<readonly [string, string]> = [
  [
    'drawer-body',
    'the bug-context drawer would render empty — a visitor gets a reproduction with no explanation of the bug.',
  ],
  [
    'runtime-label',
    'the drawer\'s Runtime row would render empty; it names the exact runtime + package versions the verdict was produced against.',
  ],
  [
    'fix-pane',
    'the fix-candidate pane would render empty. Every Layer 1 page carries both panes: either the waiting-for-baseline pre, or a note saying why no fix runs.',
  ],
];

const LAYER2_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ['title', 'the page <title> would render as "Vivarium · Reproducing ".'],
  ['h1', 'the page would render with an empty <h1>.'],
  ['lede', 'the page would open with an empty lede paragraph.'],
  [
    'reproduce-meta',
    'the "Reproduce yourself" section would not state the pull cost or link the recipe directory.',
  ],
  [
    'upstream-url',
    'the verdict envelope would carry an empty bug.upstream_url, breaking the contract-v1 surface downstream readers consume.',
  ],
];

const RETIRED_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['data-i18n="section.output.h2"', 'section.output.h2'],
  ['data-i18n="output.placeholder"', 'output.placeholder'],
];

const TEMPLATE_MARKUP: ReadonlyArray<readonly [string, string]> = [
  [
    '<header class="vh-topnav"></header>',
    'the static nav placeholder is missing, so the nav chrome.js fills lands on an unreserved page and pushes every element down after first paint.',
  ],
  [
    '<footer class="vh-footer"></footer>',
    'the static footer placeholder is missing, so the footer appears only once chrome.js runs.',
  ],
  [
    'class="vh-progress"',
    'the static loading panel is missing, so the overlay only appears once chrome.js has built it.',
  ],
];

const TEMPLATE_HEAD_MARKUP: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /<script[^>]+type="module"[^>]+src="\.\.\/_assets\/chrome\.js"/,
    'the template does not load `../_assets/chrome.js` from `<head>` as a module; loaded from the body, or reached through repro.js, the chrome arrives after first paint.',
  ],
  [
    /<link[^>]+rel="stylesheet"[^>]+fonts\.googleapis\.com/,
    'the template does not link the font stylesheet from `<head>`; reaching Google Fonts through an `@import` inside style.css blocks first paint on a second round trip.',
  ],
];

function looksLikeRecipe(name: string): boolean {
  if (name.startsWith('.')) return false;
  if (name.startsWith('_')) return false;
  return !SKIP_DIRS.has(name);
}

function slotNames(body: string): Set<string> {
  return new Set(
    [...body.matchAll(/<template\s+data-slot="([^"]+)"/g)].map(
      (m) => m[1] as string,
    ),
  );
}

function checkTemplate(path: string): void {
  if (!existsSync(path)) {
    failures.push({
      slug: '_template',
      path: relative(REPO_ROOT, path),
      reason: 'the layer has no page template — nothing can render.',
      remedy:
        'Restore the template; every recipe page in the layer is rendered from it by docs/scripts/generate-repro-pages.ts.',
    });
    return;
  }
  const body = readFileSync(path, 'utf-8');
  const headEnd = body.indexOf('</head>');
  const head = headEnd === -1 ? '' : body.slice(0, headEnd);
  for (const [needle, reason] of TEMPLATE_MARKUP) {
    if (!body.includes(needle)) {
      failures.push({
        slug: '_template',
        path: relative(REPO_ROOT, path),
        reason,
        remedy:
          'Restore the shell markup; it is what keeps first paint free of layout shift.',
      });
    }
  }
  for (const [needle, reason] of TEMPLATE_HEAD_MARKUP) {
    if (!needle.test(head)) {
      failures.push({
        slug: '_template',
        path: relative(REPO_ROOT, path),
        reason,
        remedy:
          'Restore the `<head>` block; it is what keeps first paint free of layout shift.',
      });
    }
  }
}

function checkRecipes(
  layerDir: string,
  required: ReadonlyArray<readonly [string, string]>,
): number {
  let checked = 0;
  const slugs = readdirSync(layerDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && looksLikeRecipe(e.name))
    .map((e) => e.name)
    .sort();

  for (const slug of slugs) {
    const recipeDir = join(layerDir, slug);
    const pagePath = join(recipeDir, 'page.en.html');
    if (!existsSync(pagePath)) {
      if (!existsSync(join(recipeDir, 'recipe.json'))) continue;
      failures.push({
        slug,
        path: relative(REPO_ROOT, pagePath),
        reason:
          'the recipe has no page.en.html, so no page is rendered for it.',
        remedy:
          'Copy the slots from a sibling recipe; the shared shell comes from the layer template.',
      });
      continue;
    }
    checked++;
    const body = readFileSync(pagePath, 'utf-8');
    const slots = slotNames(body);
    for (const [slot, reason] of required) {
      if (!slots.has(slot)) {
        failures.push({
          slug,
          path: relative(REPO_ROOT, pagePath),
          reason: `\`${slot}\` slot is missing — ${reason}`,
          remedy: `Add \`<template data-slot="${slot}">…</template>\`; see a sibling recipe's page.en.html.`,
        });
      }
    }
    for (const [needle, key] of RETIRED_KEYS) {
      if (body.includes(needle)) {
        failures.push({
          slug,
          path: relative(REPO_ROOT, pagePath),
          reason: `\`${key}\` is a retired single-pane i18n key and must not appear.`,
          remedy:
            'Use the two-pane keys (section.baseline.h2, output.pending, section.fix.h2) and update i18n.ja.json to match.',
        });
      }
    }

    const reproTsPath = join(recipeDir, 'repro.ts');
    if (
      existsSync(join(recipeDir, 'fix-candidate.json')) &&
      existsSync(reproTsPath)
    ) {
      const reproBody = readFileSync(reproTsPath, 'utf-8');
      if (
        !reproBody.includes('./wheels/manifest.json') &&
        !reproBody.includes('fetchWheelManifest')
      ) {
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
  return checked;
}

checkTemplate(join(LAYER1_DIR, '_shared', 'page.template.html'));
checkTemplate(join(LAYER2_DIR, '_layer2-shared', 'page.template.html'));

const recipesChecked =
  checkRecipes(LAYER1_DIR, LAYER1_SLOTS) +
  checkRecipes(LAYER2_DIR, LAYER2_SLOTS);

const sharedStylePath = join(LAYER1_DIR, '_shared', 'style.css');
if (
  existsSync(sharedStylePath) &&
  /@import[^;]*fonts\.googleapis\.com/.test(
    readFileSync(sharedStylePath, 'utf-8'),
  )
) {
  failures.push({
    slug: '_shared',
    path: relative(REPO_ROOT, sharedStylePath),
    reason:
      'style.css reaches Google Fonts through `@import`, which the browser will not paint through — every recipe page renders unstyled until that second round trip lands.',
    remedy:
      'Drop the `@import`; the template links the font stylesheet from `<head>`.',
  });
}

if (failures.length === 0) {
  console.log(
    `[validate-page-slots] OK — 2 template(s) and ${recipesChecked} recipe(s) carry every slot their page needs.`,
  );
  process.exit(0);
}

console.error(
  `[validate-page-slots] FAILED — ${failures.length} issue(s) across ${recipesChecked} recipe(s):\n`,
);
for (const f of failures) {
  console.error(`  ✗ ${f.slug} — ${f.path}`);
  console.error(`      ${f.reason}`);
  console.error(`      → ${f.remedy}\n`);
}
console.error(
  `Why this matters: a reproduction page earns its keep by showing the ` +
    `wrong result next to the right one, and by explaining the bug it ` +
    `reproduces. The template guarantees the shell; these slots are the ` +
    `part only the recipe author can supply.\n`,
);
process.exit(1);
