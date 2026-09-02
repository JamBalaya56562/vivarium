// Schema conformance for the published recipes index.
//
// `docs/site/public/api/recipes.json` is a public API (Recipes index v1)
// and `recipes.schema.json` is its published contract, but until now
// nothing validated one against the other — not this suite, not
// deploy-docs.yml, not repro-regression.yml. `recipeEntry` is
// `additionalProperties: false`, so the very first thing an added field
// does if the schema is not updated alongside it is put every consumer's
// validation into a failing state, silently, from the moment it deploys.
//
// Runs via `bun test scripts/__tests__` (docs `test:unit`).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { SITE_API_DIR } from '../site-paths';

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(SITE_API_DIR, name), 'utf-8'));
}

describe('recipes.json conforms to recipes.schema.json', () => {
  test('validates', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(readJson('recipes.schema.json') as object);
    const data = readJson('recipes.json');
    const ok = validate(data);
    if (!ok) {
      throw new Error(
        `recipes.json fails recipes.schema.json:\n${ajv.errorsText(
          validate.errors,
          { separator: '\n' },
        )}`,
      );
    }
    expect(ok).toBe(true);
  });

  test('page_url_ja is present exactly for recipes shipping i18n.ja.json', () => {
    // The field is the signal "a Japanese page exists", so it must track
    // the tracked translation source rather than being derivable.
    const data = readJson('recipes.json') as {
      recipes: { slug: string; layer: number; page_url_ja?: string }[];
    };
    const repoRoot = path.resolve(SITE_API_DIR, '..', '..', '..', '..');
    const layerDir: Record<number, string> = {
      1: 'layer1_wasm',
      2: 'layer2_docker',
      3: 'layer3_thirdway',
    };
    const mismatched = data.recipes
      .filter((r) => {
        const dir = layerDir[r.layer];
        if (!dir) return false;
        const translation = path.join(
          repoRoot,
          'src',
          dir,
          r.slug,
          'i18n.ja.json',
        );
        const hasTranslation = Bun.file(translation).size > 0;
        return hasTranslation !== (r.page_url_ja !== undefined);
      })
      .map((r) => r.slug);
    expect(mismatched).toEqual([]);
  });

  test('every page_url_ja sits under the /ja/ tree', () => {
    const data = readJson('recipes.json') as {
      recipes: { page_url_ja?: string }[];
    };
    for (const r of data.recipes) {
      if (r.page_url_ja === undefined) continue;
      expect(new URL(r.page_url_ja).pathname).toContain('/ja/repro/');
    }
  });
});
