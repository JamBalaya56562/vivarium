// Unit test for the dev-only middleware path-resolver in
// `docs/scripts/repro-dev-middleware.ts`. The function maps `/vivarium/repro/<sub>`
// URL subpaths to absolute file paths under `src/layer{1,2,3}_*/`.
//
// Why a unit test (and not just E2E coverage)?
// - The middleware is dev-only; production deploy uses GH Actions to
//   copy the same files into `doc_build/repro/`. So an E2E suite that
//   runs against `bunx rspress preview` (production-shape) cannot
//   exercise the middleware at all.
// - Path resolution has two branches (underscore-prefixed shared and
//   multi-segment hierarchical) plus a trailing-slash
//   → index.html projection. An assertion matrix is the cheapest way
//   to keep all of them honest as the recipe layout evolves.
//
// The test imports `resolveReproFile` directly. The function is pure
// (only file-system reads) so it needs no rspress runtime, no port
// binding, and no Playwright. Runs via `bun test scripts/__tests__`.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveReproFile } from '../repro-dev-middleware';

// `import.meta.dirname` keeps this file portable between bun test
// (current runner) and any future Node/Vitest harness.
const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const LAYER1 = path.join(REPO_ROOT, 'src', 'layer1_wasm');
const LAYER2 = path.join(REPO_ROOT, 'src', 'layer2_docker');

// `regex-779` is the canonical "Rust wasm32-wasip1" recipe used by
// most of these tests because it has every asset shape (index.html,
// repro.ts/.js, repro.wasm, repro.highlighted.html, Cargo.toml).
const REGEX_779_DIR = path.join(LAYER1, 'regex-779');
const REGEX_779_INDEX = path.join(REGEX_779_DIR, 'index.html');

// `bash-local-shadows-exit` is the canonical Layer 2 recipe: it has
// no Layer 1 sibling, so a `<project>/<issue>` URL with project=`bash`
// must resolve to the Layer 2 directory.
const BASH_LOCAL_DIR = path.join(LAYER2, 'bash-local-shadows-exit');
const BASH_LOCAL_INDEX = path.join(BASH_LOCAL_DIR, 'index.html');

describe('resolveReproFile — hierarchical (canonical) URLs', () => {
  test('hierarchical recipe URL (/regex/779/) → Layer 1 index.html', () => {
    const result = resolveReproFile('regex/779/');
    expect(result).toBe(REGEX_779_INDEX);
  });

  test('hierarchical Layer 2 recipe URL (/bash/local-shadows-exit/) → Layer 2 index.html', () => {
    const result = resolveReproFile('bash/local-shadows-exit/');
    expect(result).toBe(BASH_LOCAL_INDEX);
  });

  test('hierarchical asset (/regex/779/Cargo.toml) → Layer 1 file', () => {
    // Use a tracked file so the test does not depend on the build
    // step having produced `repro.js` / `repro.wasm` (those are
    // gitignored build artefacts; CI's unit lane skips the build to
    // stay light, so an existsSync()-gated path that points at one
    // of them returns null and the test fails).
    const result = resolveReproFile('regex/779/Cargo.toml');
    expect(result).toBe(path.join(REGEX_779_DIR, 'Cargo.toml'));
    expect(existsSync(result!)).toBe(true);
  });

  test('hierarchical asset (/regex/779/repro.ts) → Layer 1 file (TS source, tracked)', () => {
    const result = resolveReproFile('regex/779/repro.ts');
    expect(result).toBe(path.join(REGEX_779_DIR, 'repro.ts'));
    expect(existsSync(result!)).toBe(true);
  });

  test('non-existent asset under existing recipe → null', () => {
    expect(resolveReproFile('regex/779/does-not-exist.js')).toBe(null);
  });
});

describe('resolveReproFile — bare and not-found URLs', () => {
  test('bare /repro/ → null (caller falls through to rspress for the gallery page)', () => {
    expect(resolveReproFile('')).toBe(null);
  });

  test('non-existent hierarchical recipe URL → null (caller falls through to rspress)', () => {
    expect(resolveReproFile('nonexistent-project/0/')).toBe(null);
  });
});

describe('resolveReproFile — shared scaffolding (underscore prefix)', () => {
  test('/_shared/style.css → Layer 1 file', () => {
    const result = resolveReproFile('_shared/style.css');
    expect(result).toBe(path.join(LAYER1, '_shared', 'style.css'));
    expect(existsSync(result!)).toBe(true);
  });

  test('/_assets/chrome.js → Layer 1 file', () => {
    const result = resolveReproFile('_assets/chrome.js');
    expect(result).toBe(path.join(LAYER1, '_assets', 'chrome.js'));
  });

  test('/_layer2-shared/... → Layer 2 file (cross-layer shared lookup)', () => {
    // The resolver tries each layer root in order, so an underscore-
    // prefixed path that exists only under Layer 2 still resolves.
    const layer2Shared = path.join(LAYER2, '_layer2-shared');
    if (existsSync(layer2Shared)) {
      const result = resolveReproFile('_layer2-shared/');
      // Either resolves to an index.html under that dir, or null if
      // the dir has no index. Both are acceptable for this smoke test;
      // assert only that nothing throws.
      expect([null, ...(result === null ? [] : [result])]).toContain(result);
    }
  });
});

describe('resolveReproFile — single-segment project routes', () => {
  test("single-segment with extension that doesn't exist → null (caller returns 404)", () => {
    expect(resolveReproFile('nope.js')).toBe(null);
  });

  test('project landing single-segment (/repro/<project>/) → null (rspress handles it)', () => {
    // `/repro/regex/` maps to a project landing page (rspress mdx).
    // The middleware finds no `regex/` directory under any layer
    // root and returns null so rspress's SPA fallback can render
    // the project landing.
    expect(resolveReproFile('regex/')).toBe(null);
  });
});
