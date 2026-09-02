#!/usr/bin/env bun
//
// Mirror the shared reproduction-page scaffolding from Layer 1 into
// Layer 2, for the Playwright test server only.
//
// Why this exists
// ---------------
// `src/layer1_wasm/_assets/` (chrome.js, sw.js) and
// `src/layer1_wasm/_shared/` (style.css and the runtime modules) are the
// single tracked source of the reproduction-page chrome. Layer 2 pages
// reference them as `../_assets/...` and `../_shared/...`, exactly like
// Layer 1 pages do.
//
// Three environments resolve those references three different ways:
//
//   1. rspress dev — `docs/scripts/repro-dev-middleware.ts` sends any
//      `_`-prefixed path through a flat lookup across
//      `src/layer{1,2,3}_*` in order, so `_assets/chrome.js` already
//      resolves to the Layer 1 copy. Nothing to do.
//   2. Production deploy — `.github/workflows/deploy-docs.yml` copies
//      `src/layer1_wasm/{_assets,_shared}` into every Layer 2 project
//      directory in the Pages artefact. Nothing to do.
//   3. The Playwright suite — `src/layer1_wasm/playwright.config.ts`
//      starts a plain static server rooted at `src/layer2_docker/`
//      (port 8768). A plain file server cannot hop to another layer, so
//      the files must physically exist under `src/layer2_docker/`.
//
// This script serves case 3 alone. Its output is gitignored: Layer 2
// used to carry hand-maintained copies of `chrome.js` / `sw.js`, and the
// chrome.js copy silently drifted ~90 lines behind Layer 1 (the whole
// description-drawer feature) because dev and the deploy both served the
// Layer 1 copy, so nobody saw the stale one. Generating the mirror
// instead of tracking it makes that class of drift impossible.
//
// Mirroring `_shared/` too is free and fixes a pre-existing gap: Layer 2
// pages link `../_shared/style.css`, which has always 404'd on port 8768
// (harmlessly — a missing stylesheet is not a module error). With the
// mirror in place the Layer 2 test server is production-shaped for the
// first time.
//
// Wiring: `bun run test` in this directory (see package.json), which is
// what `mise run repro:test` and `mise run ci:repro` both invoke.
// Deliberately NOT wired into `bun run build` — the deploy path does not
// consume this mirror and must not depend on it.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAYER1_DIR = dirname(SCRIPT_DIR);
const SRC_DIR = dirname(LAYER1_DIR);
const LAYER2_DIR = join(SRC_DIR, 'layer2_docker');

/** Directory names mirrored verbatim from Layer 1 into Layer 2. */
const MIRRORED = ['_assets', '_shared'] as const;

/**
 * True when `dest` already holds a byte-identical copy of `src`. Keeps
 * the script a no-op on repeat runs so watch-mode file watchers and
 * `reuseExistingServer` don't churn.
 */
function isIdentical(src: string, dest: string): boolean {
  if (!existsSync(dest)) return false;
  const srcFiles = listFiles(src);
  const destFiles = listFiles(dest);
  if (srcFiles.length !== destFiles.length) return false;
  for (const rel of srcFiles) {
    if (!destFiles.includes(rel)) return false;
    const a = readFileSync(join(src, rel));
    const b = readFileSync(join(dest, rel));
    if (!a.equals(b)) return false;
  }
  return true;
}

/** Recursively list file paths under `root`, relative to it, sorted. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

let changed = 0;
for (const name of MIRRORED) {
  const src = join(LAYER1_DIR, name);
  const dest = join(LAYER2_DIR, name);
  if (!existsSync(src)) {
    console.warn(`[sync-layer2-assets] missing source ${src}; skipping.`);
    continue;
  }
  if (isIdentical(src, dest)) continue;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[sync-layer2-assets] mirrored ${name}/ -> src/layer2_docker/`);
  changed += 1;
}

if (changed === 0) {
  console.log('[sync-layer2-assets] already up to date.');
}
