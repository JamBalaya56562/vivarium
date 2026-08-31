#!/usr/bin/env bun
//
// CI guard: every Layer 1 recipe that ships a `fix-candidate.json`
// must also carry the matching baseline + fix-candidate side-by-side
// rendering on its recipe page.
//
// Background: `prepare_fix_candidate` (and its CI wheel-build pipeline
// in `scripts/build-layer1-wheels.sh`) builds the wheel artefact, but
// the recipe page's HTML / JS wiring is per-recipe. Without that
// wiring, the live page renders only the baseline pane and visitors
// never see the fixed verdict — the regression that motivated PR #280.
// This script catches that gap mechanically before the recipe ships.
//
// For each `src/layer1_wasm/<slug>/fix-candidate.json` it asserts:
//
//   1. `<slug>/index.html` contains `vh-output-multi` (the
//      multi-pane output column class).
//   2. `<slug>/index.html` contains `id="output-fix"` (the
//      fix-candidate `<pre>` the JS writes results into).
//   3. `<slug>/repro.ts` references the wheel manifest — either
//      directly (`./wheels/manifest.json`) or via the shared
//      helper (`fetchWheelManifest`). The helper internally points
//      at the same path, so accepting either keeps lark-1585's
//      worker pattern compatible.
//
// Exits 1 with a per-recipe failure list on any miss, so
// `bun run build` (and therefore `mise run repro:build:ts`, and
// therefore CI's `repro-regression.yml`) fails fast.
//
// Update path: when adopting a new dual-variant pattern that does not
// match (1)–(3), extend the checks here in the same PR — never silence
// the validator with a per-recipe carve-out. The point is to keep
// "fix-candidate.json exists" and "the page actually renders it"
// fused at build time.

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

let recipesChecked = 0;
for (const slug of slugs) {
  const recipeDir = join(LAYER1_DIR, slug);
  const fixCandidatePath = join(recipeDir, 'fix-candidate.json');
  if (!existsSync(fixCandidatePath)) continue;
  recipesChecked++;

  const indexPath = join(recipeDir, 'index.html');
  const reproTsPath = join(recipeDir, 'repro.ts');

  if (!existsSync(indexPath)) {
    failures.push({
      slug,
      path: relative(REPO_ROOT, indexPath),
      reason: 'index.html is missing — every Layer 1 recipe must ship one.',
      remedy:
        'Author the recipe page; see src/layer1_wasm/dateutil-1478/ or src/layer1_wasm/lark-1585/ for layout templates.',
    });
  } else {
    const indexBody = readFileSync(indexPath, 'utf-8');
    check(
      slug,
      indexPath,
      indexBody,
      'vh-output-multi',
      'output column is missing the `vh-output-multi` class — the baseline + fix-candidate dual-pane layout is not wired up.',
      'Replace the single `<pre id="output">` with the dual-pane scaffold from src/layer1_wasm/dateutil-1478/index.html (two `<header data-variant>` headers + #output + #output-fix).',
    );
    check(
      slug,
      indexPath,
      indexBody,
      'id="output-fix"',
      '`<pre id="output-fix">` is missing — the recipe JS has nowhere to write the fix-candidate output.',
      'Add the fix-candidate pane: see src/layer1_wasm/dateutil-1478/index.html for the exact markup.',
    );
  }

  if (!existsSync(reproTsPath)) {
    failures.push({
      slug,
      path: relative(REPO_ROOT, reproTsPath),
      reason: 'repro.ts is missing — every Layer 1 recipe must ship one.',
      remedy:
        'Author the recipe driver; see src/layer1_wasm/dateutil-1478/repro.ts for the dual-variant template.',
    });
  } else {
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
    `[validate-fix-candidates] OK — ${recipesChecked} recipe(s) with fix-candidate.json pass the dual-variant wiring check.`,
  );
  process.exit(0);
}

console.error(
  `[validate-fix-candidates] FAILED — ${failures.length} dual-variant wiring issue(s) across ${recipesChecked} recipe(s) with fix-candidate.json:\n`,
);
for (const f of failures) {
  console.error(`  ✗ ${f.slug} — ${f.path}`);
  console.error(`      ${f.reason}`);
  console.error(`      → ${f.remedy}\n`);
}
console.error(
  `Why this matters: the CI wheel-build pipeline ` +
    `(scripts/build-layer1-wheels.sh) only builds the artefact; the ` +
    `recipe page's HTML / JS wiring is per-recipe. Without the wiring ` +
    `above, the live page renders only the baseline pane and visitors ` +
    `never see the fixed verdict.\n`,
);
process.exit(1);
