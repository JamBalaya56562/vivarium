#!/usr/bin/env bun
//
// CI guard: every Layer 1 recipe page renders TWO output panes —
// `#output` (baseline, the buggy behaviour) and `#output-fix` (the fix
// candidate). Seeing both at once is what the page is for; one pane
// only tells a visitor that something is broken, not what "fixed"
// looks like.
//
// For each `src/layer1_wasm/<slug>/index.html` this asserts the shared
// two-pane markup is present and that the retired single-pane i18n keys
// are gone. Those keys matter because their presence means a half-done
// conversion that `reproI18n.test.ts` cannot see: the key sets in
// `index.html` and `i18n.ja.json` still agree, so that test stays green
// while the page renders the old layout.
//
// Recipes that additionally ship a `fix-candidate.json` get one more
// check: their `repro.ts` must actually install the wheel that
// `scripts/build-layer1-wheels.sh` built for them — either directly
// (`./wheels/manifest.json`) or via the shared `fetchWheelManifest`
// helper, which points at the same path, so accepting either keeps
// lark-1585's worker pattern compatible. The pipeline only produces the
// artefact; the page's wiring is per-recipe, and without it the wheel
// is invisible to visitors — the regression that motivated PR #280.
//
// How a recipe fills the fix pane is deliberately NOT prescribed here.
// Three shapes exist today: a Python wheel built from a fork branch
// (dateutil-1478, lark-1585), a second artefact compiled against a
// fixed dependency version (regex-779's `fix/` crate), and a static
// note naming the upstream status where no fixed build can run in a
// browser at all. Only the markup is universal.
//
// Exits 1 with a per-recipe failure list on any miss, so
// `bun run build` (and therefore `mise run repro:build:ts`, and
// therefore CI's `repro-regression.yml`) fails fast.
//
// Update path: when adopting a new variant mechanism, extend the checks
// here in the same PR — never silence the validator with a per-recipe
// carve-out. The point is to keep "the page claims to show a fix" and
// "the page actually shows one" fused at build time.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAYER1_DIR = dirname(SCRIPT_DIR);
const REPO_ROOT = dirname(dirname(LAYER1_DIR));

// Mirror the SKIP_DIRS / `_`-prefix convention from
// `highlight-repros.ts` so non-recipe directories (node_modules,
// scripts, tests, _shared) are not treated as recipes.
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
  /** Repo-root-relative path that failed the check. */
  path: string;
  /** Human-readable description of what is missing. */
  reason: string;
  /** What to do about it. One sentence, includes the reference recipe. */
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

/** Markup tokens the two-pane output block must contain. Checked as a
 *  token list rather than a byte-compare against a template so that
 *  indentation, the explanatory comment, and future additive attributes
 *  do not make the check brittle. */
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

/** Retired single-pane keys. Their presence means a half-done
 *  conversion: the i18n key sets in `index.html` and `i18n.ja.json`
 *  would still line up, so `reproI18n.test.ts` stays green while the
 *  page renders the old layout. */
const RETIRED_MARKUP: ReadonlyArray<readonly [string, string]> = [
  ['data-i18n="section.output.h2"', 'section.output.h2'],
  ['data-i18n="output.placeholder"', 'output.placeholder'],
];

let recipesChecked = 0;
for (const slug of slugs) {
  const recipeDir = join(LAYER1_DIR, slug);
  const indexPath = join(recipeDir, 'index.html');
  const reproTsPath = join(recipeDir, 'repro.ts');

  // A directory without an index.html is not a recipe page; the
  // `_`-prefix / SKIP_DIRS filter above already removes the known
  // non-recipe directories, and this covers anything new.
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

  // The wheel-pipeline check stays conditional: it only applies to
  // recipes whose fix candidate is a Python wheel. Recipes that fill
  // the pane another way (regex-779 builds a second wasm) or that have
  // no runnable fix at all render the pane statically and are covered
  // by the markup checks above.
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
