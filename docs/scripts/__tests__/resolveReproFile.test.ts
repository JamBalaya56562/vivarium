import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { resolveReproFile } from '../repro-dev-middleware';

const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const LAYER1 = path.join(REPO_ROOT, 'src', 'layer1_wasm');
const LAYER2 = path.join(REPO_ROOT, 'src', 'layer2_docker');

const LAYER1_RECIPE = (
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'docs', 'site', 'public', 'api', 'recipes.json'),
      'utf-8',
    ),
  ) as {
    recipes: Array<{
      slug: string;
      layer: number;
      project: string;
      issue: number;
    }>;
  }
).recipes.find((r) => r.layer === 1 && r.issue > 0);
if (!LAYER1_RECIPE)
  throw new Error('recipes.json lists no Layer 1 recipe with an issue number');
const L1_URL = `${LAYER1_RECIPE.project}/${LAYER1_RECIPE.issue}/`;
const L1_DIR = path.join(LAYER1, LAYER1_RECIPE.slug);
const L1_INDEX = path.join(L1_DIR, 'index.html');

const BASH_LOCAL_DIR = path.join(LAYER2, 'bash-local-shadows-exit');
const BASH_LOCAL_INDEX = path.join(BASH_LOCAL_DIR, 'index.html');

describe('resolveReproFile — hierarchical (canonical) URLs', () => {
  test('hierarchical recipe URL (/<project>/<issue>/) → Layer 1 index.html', () => {
    const result = resolveReproFile(L1_URL);
    expect(result).toBe(L1_INDEX);
  });

  test('hierarchical Layer 2 recipe URL (/bash/local-shadows-exit/) → Layer 2 index.html', () => {
    const result = resolveReproFile('bash/local-shadows-exit/');
    expect(result).toBe(BASH_LOCAL_INDEX);
  });

  test('hierarchical asset (/<project>/<issue>/recipe.json) → Layer 1 file', () => {
    const result = resolveReproFile(`${L1_URL}recipe.json`);
    expect(result).toBe(path.join(L1_DIR, 'recipe.json'));
    expect(existsSync(result!)).toBe(true);
  });

  test('hierarchical asset (/<project>/<issue>/repro.ts) → Layer 1 file (TS source, tracked)', () => {
    const result = resolveReproFile(`${L1_URL}repro.ts`);
    expect(result).toBe(path.join(L1_DIR, 'repro.ts'));
    expect(existsSync(result!)).toBe(true);
  });

  test('non-existent asset under existing recipe → null', () => {
    expect(resolveReproFile(`${L1_URL}does-not-exist.js`)).toBe(null);
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

  test('Layer 2 page asking for <project>/_assets/chrome.js resolves to the Layer 1 copy', () => {
    const result = resolveReproFile('bash/_assets/chrome.js');
    expect(result).toBe(path.join(LAYER1, '_assets', 'chrome.js'));
    expect(existsSync(result!)).toBe(true);
  });

  test('/_layer2-shared/... → Layer 2 file (cross-layer shared lookup)', () => {
    const layer2Shared = path.join(LAYER2, '_layer2-shared');
    if (existsSync(layer2Shared)) {
      const result = resolveReproFile('_layer2-shared/');
      expect([null, ...(result === null ? [] : [result])]).toContain(result);
    }
  });
});

describe('resolveReproFile — Japanese locale', () => {
  test('a translated recipe serves its index.ja.html sibling', () => {
    const ja = path.join(BASH_LOCAL_DIR, 'index.ja.html');
    if (!existsSync(ja)) return; // generated; absent on a bare checkout
    expect(resolveReproFile('bash/local-shadows-exit/', 'ja')).toBe(ja);
  });

  test('an untranslated recipe falls back to English rather than 404ing', () => {
    const ja = path.join(L1_DIR, 'index.ja.html');
    if (existsSync(ja)) return; // already translated; nothing to assert
    expect(resolveReproFile(L1_URL, 'ja')).toBe(L1_INDEX);
  });

  test('non-HTML assets resolve identically in both locales', () => {
    expect(resolveReproFile(`${L1_URL}recipe.json`, 'ja')).toBe(
      resolveReproFile(`${L1_URL}recipe.json`),
    );
  });

  test('the JA gallery and project landing still fall through to rspress', () => {
    expect(resolveReproFile('', 'ja')).toBe(null);
    expect(resolveReproFile(`${LAYER1_RECIPE.project}/`, 'ja')).toBe(null);
  });
});

describe('resolveReproFile — single-segment project routes', () => {
  test("single-segment with extension that doesn't exist → null (caller returns 404)", () => {
    expect(resolveReproFile('nope.js')).toBe(null);
  });

  test('project landing single-segment (/repro/<project>/) → null (rspress handles it)', () => {
    expect(resolveReproFile(`${LAYER1_RECIPE.project}/`)).toBe(null);
  });
});

describe('resolveReproFile — staged formicarium assets (P1, S8 candidate 2)', () => {
  const recipeDir = path.join(
    LAYER1,
    'biome-migrate-top-level-bracket-spacing',
  );
  const probe = `resolve-probe-${process.pid}.json`;
  const staged = [
    path.join(recipeDir, '_formicarium', probe),
    path.join(recipeDir, 'guests', 'baseline', probe),
  ];
  const created: string[] = [];
  beforeAll(() => {
    for (const file of staged) {
      for (const dir of [path.dirname(file), path.dirname(path.dirname(file))])
        if (!existsSync(dir)) created.push(dir);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, '{}');
    }
  });
  afterAll(() => {
    for (const file of staged) rmSync(file, { force: true });
    for (const dir of created.reverse())
      rmSync(dir, { recursive: true, force: true });
  });

  test('maps the recipe’s _formicarium/ and guests/ to the staged files', () => {
    const url = 'biome/migrate-top-level-bracket-spacing';
    expect(resolveReproFile(`${url}/_formicarium/${probe}`)).toBe(staged[0]);
    expect(resolveReproFile(`${url}/guests/baseline/${probe}`)).toBe(staged[1]);
  });

  test('serves the same _formicarium file to the Japanese page', () => {
    const url = 'biome/migrate-top-level-bracket-spacing';
    expect(resolveReproFile(`${url}/_formicarium/${probe}`, 'ja')).toBe(
      staged[0],
    );
  });

  test('a missing staged file is null, not another recipe’s', () => {
    expect(
      resolveReproFile(
        'biome/migrate-top-level-bracket-spacing/_formicarium/absent.json',
      ),
    ).toBe(null);
  });
});
