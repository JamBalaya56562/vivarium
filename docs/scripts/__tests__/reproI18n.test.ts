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
  test('the rendered pages this suite reads exist', () => {
    expect(RECIPES.length).toBeGreaterThan(0);
  });

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
      const slug = path.basename(recipe.dir);
      expect(parsed.slug).toBe(slug === '_template' ? '{{SLUG}}' : slug);
    });

    test(`${recipe.label}: <title> translation is plain text`, () => {
      const parsed = JSON.parse(readFileSync(recipe.translation, 'utf-8')) as {
        strings?: Record<string, string>;
      };
      const title = parsed.strings?.['page.title'];
      if (title === undefined) return;
      expect(title).not.toMatch(/<[a-zA-Z]/);
    });
  }
});

describe('repro i18n — EN/JA coverage', () => {
  test('every reproduction page ships a translation', () => {
    const missing = RECIPES.filter((r) => !existsSync(r.translation)).map(
      (r) => r.label,
    );
    expect(missing).toEqual([]);
  });

  test('the Layer 2 scaffolder template ships a translation', () => {
    const tpl = RECIPES.find((r) => r.label.endsWith('_template'));
    expect(tpl).toBeDefined();
    expect(existsSync(tpl?.translation ?? '')).toBe(true);
  });
});
