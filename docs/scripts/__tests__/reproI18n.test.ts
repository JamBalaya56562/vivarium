// Translation-coverage guard for the reproduction pages.
//
// `index.html` is the English source of truth; `i18n.ja.json` holds the
// Japanese strings; `index.ja.html` is their generated splice. The
// failure this suite exists to catch is the two tracked files drifting
// apart — a `data-i18n` added to the HTML with no translation written,
// or a translation left behind after its element was removed. Either one
// would otherwise surface as English text on a Japanese page (or a
// silently ignored key), which nobody notices.
//
// Runs via `bun test scripts/__tests__` (docs `test:unit`).

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../site-paths';

const LAYERS = ['layer1_wasm', 'layer2_docker'] as const;

interface Recipe {
  label: string;
  dir: string;
  html: string;
  translation: string;
}

/** Every directory that ships a reproduction page, template included. */
function listRecipes(includeTemplate: boolean): Recipe[] {
  const out: Recipe[] = [];
  for (const layer of LAYERS) {
    const root = path.join(REPO_ROOT, 'src', layer);
    if (!existsSync(root)) continue;
    for (const slug of readdirSync(root).sort()) {
      if (slug.startsWith('.')) continue;
      if (slug.startsWith('_') && !(includeTemplate && slug === '_template')) {
        continue;
      }
      const dir = path.join(root, slug);
      const html = path.join(dir, 'index.html');
      if (!existsSync(html)) continue;
      out.push({
        label: `src/${layer}/${slug}`,
        dir,
        html,
        translation: path.join(dir, 'i18n.ja.json'),
      });
    }
  }
  return out;
}

/** Keys referenced by `data-i18n` / `data-i18n-attr` in the source HTML. */
function htmlKeys(html: string): string[] {
  const keys: string[] = [];
  for (const m of html.matchAll(/\sdata-i18n="([^"]*)"/g)) {
    if (m[1]) keys.push(m[1]);
  }
  for (const m of html.matchAll(/\sdata-i18n-attr="([^"]*)"/g)) {
    for (const pair of (m[1] ?? '').split(';')) {
      const eq = pair.indexOf('=');
      if (eq >= 0) keys.push(pair.slice(eq + 1).trim());
    }
  }
  return keys;
}

const RECIPES = listRecipes(true);

describe('repro i18n — annotation and translation keys agree', () => {
  for (const recipe of RECIPES) {
    if (!existsSync(recipe.translation)) continue;

    test(`${recipe.label}: key sets match`, () => {
      const html = readFileSync(recipe.html, 'utf-8');
      const parsed = JSON.parse(readFileSync(recipe.translation, 'utf-8')) as {
        strings?: Record<string, string>;
      };
      const inHtml = new Set(htmlKeys(html));
      const inJson = new Set(Object.keys(parsed.strings ?? {}));
      const untranslated = [...inHtml].filter((k) => !inJson.has(k)).sort();
      const orphaned = [...inJson].filter((k) => !inHtml.has(k)).sort();
      expect({ untranslated, orphaned }).toEqual({
        untranslated: [],
        orphaned: [],
      });
    });

    test(`${recipe.label}: no duplicate data-i18n key`, () => {
      const keys = htmlKeys(readFileSync(recipe.html, 'utf-8'));
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect([...new Set(dupes)]).toEqual([]);
    });

    test(`${recipe.label}: translation envelope is well-formed`, () => {
      const parsed = JSON.parse(readFileSync(recipe.translation, 'utf-8')) as {
        schema_version?: number;
        lang?: string;
        slug?: string;
      };
      expect(parsed.schema_version).toBe(1);
      expect(parsed.lang).toBe('ja');
      // `_template` keeps the scaffolder placeholder; real recipes carry
      // their directory name.
      const slug = path.basename(recipe.dir);
      expect(parsed.slug).toBe(slug === '_template' ? '{{SLUG}}' : slug);
    });

    test(`${recipe.label}: <title> translation is plain text`, () => {
      const parsed = JSON.parse(readFileSync(recipe.translation, 'utf-8')) as {
        strings?: Record<string, string>;
      };
      const title = parsed.strings?.['page.title'];
      if (title === undefined) return;
      // Markup inside <title> is not parsed as markup — it renders
      // literally in the browser tab.
      expect(title).not.toMatch(/<[a-zA-Z]/);
    });
  }
});

describe('repro i18n — EN/JA coverage', () => {
  test('every reproduction page ships a translation', () => {
    // ADR-0028's i18n Definition of Done: EN + JA in the same PR. This
    // is the reproduction-page counterpart of the docs-tree symmetry
    // assertion in docs/tests/i18n.spec.ts.
    const missing = RECIPES.filter((r) => !existsSync(r.translation)).map(
      (r) => r.label,
    );
    expect(missing).toEqual([]);
  });

  test('the Layer 2 scaffolder template ships a translation', () => {
    // A new recipe copied from the template must be bilingual from
    // birth, otherwise the next recipe silently reintroduces the gap.
    const tpl = RECIPES.find((r) => r.label.endsWith('_template'));
    expect(tpl).toBeDefined();
    expect(existsSync(tpl?.translation ?? '')).toBe(true);
  });
});
