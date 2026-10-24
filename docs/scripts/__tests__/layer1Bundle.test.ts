import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { servedByPages } from '../serve-repro';
import { REPO_ROOT } from '../site-paths';

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'bundle-layer1-pages.sh');
const SLUG = 'biome-migrate-top-level-bracket-spacing';

function put(root: string, rel: string, body = rel): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory())
      out.push(...files(full).map((f) => `${name}/${f}`));
    else out.push(name);
  }
  return out.sort();
}

describe('.gitignore keeps staged formicarium assets out of the tree (P1)', () => {
  test('ignores each recipe’s _formicarium/ and guests/ but not its sources', () => {
    const ignored = (rel: string) =>
      Bun.spawnSync(['git', 'check-ignore', '-q', '--no-index', rel], {
        cwd: REPO_ROOT,
      }).exitCode === 0;
    for (const rel of [
      `src/layer1_wasm/${SLUG}/_formicarium/assets.json`,
      `src/layer1_wasm/${SLUG}/_formicarium/0.4.0/assets/paludarium/paludarium.wasm`,
      `src/layer1_wasm/${SLUG}/guests/baseline/biome`,
      `src/layer1_wasm/${SLUG}/guests/fix/build-info.json`,
    ])
      expect({ rel, ignored: ignored(rel) }).toEqual({ rel, ignored: true });
    for (const rel of [
      `src/layer1_wasm/${SLUG}/recipe.json`,
      `src/layer1_wasm/${SLUG}/coi-serviceworker.js`,
      `src/layer1_wasm/${SLUG}/fixture/biome.json`,
    ])
      expect({ rel, ignored: ignored(rel) }).toEqual({ rel, ignored: false });
  });
});

describe('serve-repro serves the deployed /ja/ shape (S8 candidate 2)', () => {
  const ja = '/vivarium/ja/repro/biome/migrate-top-level-bracket-spacing/';
  test('serves the page, its service worker and its _formicarium copy', () => {
    expect(servedByPages(ja)).toBe(true);
    expect(servedByPages(`${ja}index.html`)).toBe(true);
    expect(servedByPages(`${ja}coi-serviceworker.js`)).toBe(true);
    expect(servedByPages(`${ja}_formicarium/assets.json`)).toBe(true);
    expect(
      servedByPages(
        `${ja}_formicarium/0.4.0/runtime/web/package-worker.bundle.js`,
      ),
    ).toBe(true);
  });

  test('keeps every other /ja/ path at 404', () => {
    for (const rel of [
      'recipe.json',
      'repro.js',
      'guests/baseline/biome',
      'fixture/biome.json',
      '_formicarium',
    ])
      expect({ rel, served: servedByPages(`${ja}${rel}`) }).toEqual({
        rel,
        served: false,
      });
    expect(servedByPages('/vivarium/ja/repro/biome/_formicarium/x.js')).toBe(
      false,
    );
    expect(servedByPages('/vivarium/repro/biome/x/recipe.json')).toBe(true);
  });
});

describe('bundle-layer1-pages.sh (P1, S8 candidate 2)', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'vivarium-bundle-'));
    put(root, 'src/layer1_wasm/_shared/style.css');
    const recipe = `src/layer1_wasm/${SLUG}`;
    for (const rel of [
      'index.html',
      'index.ja.html',
      'coi-serviceworker.js',
      'repro.js',
      '_formicarium/assets.json',
      '_formicarium/0.4.0/runtime/web/api.js',
      '_formicarium/0.4.0/assets/paludarium/paludarium.wasm',
      'guests/baseline/biome',
      'guests/fix/biome',
    ])
      put(root, `${recipe}/${rel}`);
    put(
      root,
      `${recipe}/recipe.json`,
      JSON.stringify({ expected_runtime: 'formicarium' }),
    );
    put(root, 'src/layer1_wasm/biome-pending/index.html');
    put(
      root,
      'src/layer1_wasm/biome-pending/recipe.json',
      JSON.stringify({ expected_runtime: 'formicarium' }),
    );
    put(
      root,
      'docs/site/public/api/recipes.json',
      JSON.stringify({
        recipes: [
          {
            slug: SLUG,
            layer: 1,
            project: 'biome',
            page_url:
              'https://aletheia-works.github.io/vivarium/repro/biome/migrate-top-level-bracket-spacing/',
          },
        ],
      }),
    );
    const run = Bun.spawnSync(['bash', SCRIPT], {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_REPOSITORY_OWNER: 'aletheia-works',
        GITHUB_REPOSITORY: 'aletheia-works/vivarium',
      },
    });
    if (run.exitCode !== 0)
      throw new Error(
        `bundle failed: ${run.stdout.toString()}${run.stderr.toString()}`,
      );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('copies the recipe with its staged assets into the English dir', () => {
    const en = path.join(
      root,
      'docs/doc_build/repro/biome/migrate-top-level-bracket-spacing',
    );
    expect(files(en)).toEqual([
      '_formicarium/0.4.0/assets/paludarium/paludarium.wasm',
      '_formicarium/0.4.0/runtime/web/api.js',
      '_formicarium/assets.json',
      'coi-serviceworker.js',
      'guests/baseline/biome',
      'guests/fix/biome',
      'index.html',
      'recipe.json',
      'repro.js',
    ]);
  });

  test('gives the Japanese dir the page, the service worker and _formicarium only', () => {
    const ja = path.join(
      root,
      'docs/doc_build/ja/repro/biome/migrate-top-level-bracket-spacing',
    );
    expect(files(ja)).toEqual([
      '_formicarium/0.4.0/assets/paludarium/paludarium.wasm',
      '_formicarium/0.4.0/runtime/web/api.js',
      '_formicarium/assets.json',
      'coi-serviceworker.js',
      'index.html',
    ]);
  });

  test('keeps each ELF in one place and no _formicarium outside the recipe', () => {
    const all = files(path.join(root, 'docs/doc_build'));
    expect(all.filter((f) => f.endsWith('/biome'))).toEqual([
      'repro/biome/migrate-top-level-bracket-spacing/guests/baseline/biome',
      'repro/biome/migrate-top-level-bracket-spacing/guests/fix/biome',
    ]);
    expect(
      all.filter((f) => f.includes('_formicarium/assets.json')).sort(),
    ).toEqual([
      'ja/repro/biome/migrate-top-level-bracket-spacing/_formicarium/assets.json',
      'repro/biome/migrate-top-level-bracket-spacing/_formicarium/assets.json',
    ]);
  });

  test('skips a pending formicarium recipe that is not in the index', () => {
    expect(
      existsSync(path.join(root, 'docs/doc_build/repro/biome/pending')),
    ).toBe(false);
    expect(
      files(path.join(root, 'docs/doc_build')).some((f) =>
        f.includes('pending'),
      ),
    ).toBe(false);
  });
});
