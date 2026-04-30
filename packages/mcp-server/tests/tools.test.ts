// Tool-level smoke tests. Stub fetch with a fixture catalogue and
// exercise list_recipes / get_recipe / lookup_verdict's branching.

import { afterEach, beforeEach, describe, it } from 'bun:test';
import { strict as assert } from 'node:assert';

import { _resetCacheForTesting, INDEX_URL } from '../src/catalogue.ts';
import { getRecipe } from '../src/tools/get_recipe.ts';
import { listRecipes } from '../src/tools/list_recipes.ts';
import { lookupVerdict } from '../src/tools/lookup_verdict.ts';

const FIXTURE_INDEX = {
  index: 'v1',
  contract: 'v1',
  recipes: [
    {
      slug: 'pandas-56679',
      layer: 1,
      project: 'pandas',
      issue: 56679,
      title: 'pandas-dev/pandas#56679',
      page_url: 'https://example.invalid/repro/pandas-56679/',
      source_url: 'https://example.invalid/src/pandas-56679',
    },
    {
      slug: 'bash-local-shadows-exit',
      layer: 2,
      project: 'bash',
      issue: 0,
      title: 'bash local-shadows-exit',
      page_url: 'https://example.invalid/repro/bash-local-shadows-exit/',
      verdict_url: 'https://example.invalid/repro/bash-local-shadows-exit/verdict.json',
      source_url: 'https://example.invalid/src/bash-local-shadows-exit',
    },
    {
      slug: 'lost-update',
      layer: 3,
      project: 'pthread',
      issue: 0,
      title: 'pthread lost-update data race',
      page_url: 'https://example.invalid/repro/lost-update/',
      verdict_url: 'https://example.invalid/repro/lost-update/verdict.json',
      source_url: 'https://example.invalid/src/lost-update',
    },
  ],
};

const FIXTURE_VERDICT = {
  contract: 'v1',
  verdict: 'pass',
  exit_code: 0,
  image_tag: 'ghcr.io/example-org/bash:latest',
  image_digest: 'sha256:deadbeef',
  captured_at: '2026-04-30T00:00:00Z',
  stdout: '',
  stderr_tail: '',
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetCacheForTesting();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === INDEX_URL) {
      return new Response(JSON.stringify(FIXTURE_INDEX), { status: 200 });
    }
    if (url.endsWith('/verdict.json')) {
      return new Response(JSON.stringify(FIXTURE_VERDICT), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  _resetCacheForTesting();
});

describe('list_recipes', () => {
  it('returns all when no filters', async () => {
    const r = await listRecipes({});
    assert.equal(r.count, 3);
  });

  it('filters by layer', async () => {
    const r = await listRecipes({ layer: 1 });
    assert.equal(r.count, 1);
    assert.equal(r.recipes[0]!.slug, 'pandas-56679');
  });

  it('filters by project (case-insensitive)', async () => {
    const r = await listRecipes({ project: 'PTHREAD' });
    assert.equal(r.count, 1);
    assert.equal(r.recipes[0]!.slug, 'lost-update');
  });

  it('filters by free-text q across slug/project/title', async () => {
    const r = await listRecipes({ q: 'shadows' });
    assert.equal(r.count, 1);
    assert.equal(r.recipes[0]!.slug, 'bash-local-shadows-exit');
  });

  it('combines filters with logical AND', async () => {
    const r = await listRecipes({ layer: 2, project: 'pandas' });
    assert.equal(r.count, 0);
  });
});

describe('get_recipe', () => {
  it('returns the recipe when slug exists', async () => {
    const r = await getRecipe({ slug: 'pandas-56679' });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.recipe.layer, 1);
  });

  it('returns found=false on unknown slug', async () => {
    const r = await getRecipe({ slug: 'does-not-exist' });
    assert.equal(r.found, false);
  });

  it('returns found=false on missing slug arg', async () => {
    const r = await getRecipe({ slug: '' });
    assert.equal(r.found, false);
  });
});

describe('lookup_verdict', () => {
  it('returns kind=live for Layer 1', async () => {
    const r = await lookupVerdict({ slug: 'pandas-56679' });
    assert.equal(r.kind, 'live');
    if (r.kind === 'live') {
      assert.match(r.page_url, /pandas-56679/);
    }
  });

  it('returns kind=snapshot for Layer 2', async () => {
    const r = await lookupVerdict({ slug: 'bash-local-shadows-exit' });
    assert.equal(r.kind, 'snapshot');
    if (r.kind === 'snapshot') {
      assert.equal(r.snapshot.verdict, 'pass');
      assert.equal(r.snapshot.contract, 'v1');
    }
  });

  it('returns kind=snapshot for Layer 3', async () => {
    const r = await lookupVerdict({ slug: 'lost-update' });
    assert.equal(r.kind, 'snapshot');
  });

  it('returns kind=not_found for unknown slug', async () => {
    const r = await lookupVerdict({ slug: 'does-not-exist' });
    assert.equal(r.kind, 'not_found');
  });
});
