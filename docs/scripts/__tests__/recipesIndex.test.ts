import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  loadGuestAllowlist,
  RecipeDeclarationError,
  readFormicariumRecipe,
  recipeState,
  validateRecipeGuests,
} from '../generate-recipes-index';
import { REPO_ROOT, SITE_API_DIR, SITE_SPEC_DIR } from '../site-paths';

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

const allowlist = loadGuestAllowlist();
const BASELINE_COMMIT = 'a'.repeat(40);
const FIX_COMMIT = 'a5bd0ce883a22980be20dfc87ba62006a43c3de8';

function accepted(commit: string, seed: string) {
  return {
    commit,
    versionOrName: '2.5.0',
    buildKey: seed.repeat(64),
    elfSha256: seed.repeat(64),
    buildInfoSha256: seed.repeat(64),
  };
}

function guest(role: string, overrides: Record<string, unknown> = {}) {
  return {
    role,
    tool: 'biome',
    repository:
      role === 'fix'
        ? 'https://github.com/jambalaya56562/biome'
        : 'https://github.com/biomejs/biome',
    commit: role === 'fix' ? FIX_COMMIT : BASELINE_COMMIT,
    fixture: 'biome-migrate-prettier-override',
    reference: { branch: role === 'fix' ? 'fix/branch' : 'main' },
    ...overrides,
  };
}

function formicariumMeta(guests: unknown, extra: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    language: 'shell',
    expected_verdict: 'reproduced',
    expected_runtime: 'formicarium',
    guests,
    ...extra,
  };
}

function rejection(meta: Record<string, unknown>): string {
  try {
    validateRecipeGuests('demo', meta, allowlist);
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeDeclarationError);
    return (error as Error).message;
  }
  throw new Error('expected the declaration to be rejected');
}

describe('formicarium recipe guests (BR1.1–BR1.4, BR1.7, BR1.8)', () => {
  test('accepts a baseline and a fix and keeps them pending without accepted or a pin', () => {
    const guests = validateRecipeGuests(
      'demo',
      formicariumMeta([guest('baseline'), guest('fix')]),
      allowlist,
    );
    expect(guests?.map((g) => g.role)).toEqual(['baseline', 'fix']);
    expect(guests?.[1]?.reference).toEqual({ branch: 'fix/branch' });
    expect(recipeState(guests ?? [], false)).toEqual({
      state: 'pending',
      reasons: ['accepted-missing', 'pin-missing'],
    });
  });

  test('is active only when every guest is accepted and the pin exists', () => {
    const guests =
      validateRecipeGuests(
        'demo',
        formicariumMeta([
          guest('baseline', { accepted: accepted(BASELINE_COMMIT, 'b') }),
          guest('fix', { accepted: accepted(FIX_COMMIT, 'c') }),
        ]),
        allowlist,
      ) ?? [];
    expect(recipeState(guests, true)).toEqual({ state: 'active' });
    expect(recipeState(guests, false)).toEqual({
      state: 'pending',
      reasons: ['pin-missing'],
    });
    const oneMissing =
      validateRecipeGuests(
        'demo',
        formicariumMeta([
          guest('baseline', { accepted: accepted(BASELINE_COMMIT, 'b') }),
          guest('fix'),
        ]),
        allowlist,
      ) ?? [];
    expect(recipeState(oneMissing, true)).toEqual({
      state: 'pending',
      reasons: ['accepted-missing'],
    });
  });

  test('requires guests and refuses fix_candidate on a formicarium recipe', () => {
    expect(rejection(formicariumMeta(undefined))).toContain('non-empty guests');
    expect(rejection(formicariumMeta([]))).toContain('non-empty guests');
    expect(
      rejection(
        formicariumMeta([guest('baseline')], {
          fix_candidate: {
            repository: 'jambalaya56562/biome',
            branch: 'fix/branch',
            commit: FIX_COMMIT,
          },
        }),
      ),
    ).toContain('not fix_candidate');
  });

  test('refuses a repeated role, a missing baseline and an unknown role', () => {
    expect(
      rejection(formicariumMeta([guest('baseline'), guest('baseline')])),
    ).toContain('role baseline 2 times');
    expect(rejection(formicariumMeta([guest('fix')]))).toContain(
      'has no baseline',
    );
    expect(
      rejection(formicariumMeta([guest('baseline'), guest('candidate')])),
    ).toContain('role must be baseline or fix');
  });

  test('refuses a repository that is not normalized, not GitHub or not allowlisted', () => {
    for (const repository of [
      'https://github.com/BiomeJS/biome',
      'https://github.com/biomejs/biome.git',
      'http://github.com/biomejs/biome',
      'https://user@github.com/biomejs/biome',
      'https://gitlab.com/biomejs/biome',
    ]) {
      expect(
        rejection(formicariumMeta([guest('baseline', { repository })])),
      ).toContain('guests[0]');
    }
    expect(
      rejection(
        formicariumMeta([
          guest('baseline', { repository: 'https://github.com/someone/biome' }),
        ]),
      ),
    ).toContain('not in the allowlist');
  });

  test('refuses a commit that is not 40 lowercase hexadecimal characters', () => {
    for (const commit of ['a'.repeat(39), 'A'.repeat(40), 'main', undefined]) {
      expect(
        rejection(formicariumMeta([guest('baseline', { commit })])),
      ).toContain('commit');
    }
  });

  test('refuses a partial accepted and a malformed accepted digest', () => {
    const partial: Record<string, unknown> = accepted(BASELINE_COMMIT, 'b');
    delete partial.buildInfoSha256;
    expect(
      rejection(formicariumMeta([guest('baseline', { accepted: partial })])),
    ).toContain('accepted is partial (missing buildInfoSha256)');
    expect(
      rejection(
        formicariumMeta([
          guest('baseline', {
            accepted: { ...accepted(BASELINE_COMMIT, 'b'), buildKey: 'b' },
          }),
        ]),
      ),
    ).toContain('accepted.buildKey');
    expect(
      rejection(
        formicariumMeta([
          guest('baseline', {
            accepted: { ...accepted(BASELINE_COMMIT, 'b'), extra: 'x' },
          }),
        ]),
      ),
    ).toContain('unknown fields: extra');
  });

  test('leaves other runtimes as they were and refuses guests on them', () => {
    expect(
      validateRecipeGuests(
        'demo',
        {
          schema_version: 1,
          language: 'python',
          expected_runtime: 'pyodide',
          fix_candidate: {
            repository: 'a/b',
            branch: 'main',
            commit: FIX_COMMIT,
          },
        },
        allowlist,
      ),
    ).toBeUndefined();
    expect(
      rejection({
        schema_version: 1,
        language: 'python',
        expected_runtime: 'pyodide',
        guests: [guest('baseline')],
      }),
    ).toContain('only for expected_runtime "formicarium"');
  });

  test('every shipped recipe.json passes the declaration check', () => {
    const layer1 = path.join(REPO_ROOT, 'src', 'layer1_wasm');
    for (const slug of readdirSync(layer1)) {
      if (slug.startsWith('_') || slug.startsWith('.')) continue;
      expect(() =>
        readFormicariumRecipe(slug, path.join(layer1, slug), allowlist, false),
      ).not.toThrow();
    }
  });
});

describe('readFormicariumRecipe', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('reads the recipe file and reports its state', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'vivarium-recipe-'));
    await mkdir(path.join(dir, 'demo'));
    await writeFile(
      path.join(dir, 'demo', 'recipe.json'),
      JSON.stringify(formicariumMeta([guest('baseline')])),
    );
    const recipe = readFormicariumRecipe(
      'demo',
      path.join(dir, 'demo'),
      allowlist,
      true,
    );
    expect(recipe?.state).toEqual({
      state: 'pending',
      reasons: ['accepted-missing'],
    });
    expect(
      readFormicariumRecipe('none', path.join(dir, 'none'), allowlist, true),
    ).toBeUndefined();
  });
});

describe('recipe.schema.json guests', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(
      readFileSync(path.join(SITE_SPEC_DIR, 'recipe.schema.json'), 'utf-8'),
    ) as object,
  );

  test('accepts a pending and an accepted declaration', () => {
    expect(validate(formicariumMeta([guest('baseline'), guest('fix')]))).toBe(
      true,
    );
    expect(
      validate(
        formicariumMeta([
          guest('baseline', { accepted: accepted(BASELINE_COMMIT, 'b') }),
        ]),
      ),
    ).toBe(true);
  });

  test('refuses a partial accepted, an unknown role and a third guest', () => {
    const partial: Record<string, unknown> = accepted(BASELINE_COMMIT, 'b');
    delete partial.elfSha256;
    expect(
      validate(formicariumMeta([guest('baseline', { accepted: partial })])),
    ).toBe(false);
    expect(validate(formicariumMeta([guest('candidate')]))).toBe(false);
    expect(
      validate(
        formicariumMeta([guest('baseline'), guest('fix'), guest('fix')]),
      ),
    ).toBe(false);
  });
});
