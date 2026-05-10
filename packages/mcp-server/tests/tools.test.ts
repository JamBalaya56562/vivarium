// Tool-level smoke tests. Stub fetch with a fixture catalogue and
// exercise list_recipes / get_recipe / lookup_verdict's branching.

import { afterEach, beforeEach, describe, it } from 'bun:test';
import { strict as assert } from 'node:assert';

import { _resetCacheForTesting, INDEX_URL } from '../src/catalogue.ts';
import { getRecipe } from '../src/tools/get_recipe.ts';
import { listRecipes } from '../src/tools/list_recipes.ts';
import { lookupVerdict } from '../src/tools/lookup_verdict.ts';
import { matchError } from '../src/tools/match_error.ts';
import { prepareFixCandidate } from '../src/tools/prepare_fix_candidate.ts';
import { prepareNewRecipe } from '../src/tools/prepare_new_recipe.ts';
import { verifyBranchFix } from '../src/tools/verify_branch_fix.ts';

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
      page_url: 'https://example.invalid/repro/pandas/56679/',
      source_url: 'https://example.invalid/src/pandas-56679',
      language: 'python',
      symptom: 'dtype-mismatch',
      severity: 'regression',
      tags: ['empty-series', 'empty-dataframe', 'type-inference'],
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
      language: 'shell',
      symptom: 'local-shadows-exit-status',
      severity: 'footgun',
      tags: ['command-substitution', 'exit-code'],
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
      language: 'c',
      symptom: 'lost-update-data-race',
      severity: 'datarace',
      tags: ['rr-replay', 'deterministic'],
    },
  ],
};

const FIXTURE_VERDICT = {
  contract: 'v1',
  verdict: 'reproduced',
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
      assert.match(r.page_url, /pandas\/56679/);
    }
  });

  it('returns kind=snapshot for Layer 2', async () => {
    const r = await lookupVerdict({ slug: 'bash-local-shadows-exit' });
    assert.equal(r.kind, 'snapshot');
    if (r.kind === 'snapshot') {
      assert.equal(r.snapshot.verdict, 'reproduced');
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

describe('match_error', () => {
  it('returns the highest-scoring recipe for a relevant error fragment', async () => {
    const r = await matchError({
      text: 'ValueError: dtype mismatch on empty Series in pandas DataFrame',
    });
    assert.equal('ok' in r && r.ok, true);
    if ('ok' in r && r.ok) {
      assert.equal(r.matches[0]!.recipe.slug, 'pandas-56679');
      assert.ok(r.matches[0]!.score >= 5);
    }
  });

  it('orders multiple matches by score descending', async () => {
    const r = await matchError({
      text: 'pandas dtype mismatch and bash local exit-code shadows',
    });
    if ('ok' in r && r.ok) {
      assert.ok(r.matches.length >= 2);
      for (let i = 1; i < r.matches.length; i++) {
        assert.ok(
          r.matches[i - 1]!.score >= r.matches[i]!.score,
          'scores must be non-increasing',
        );
      }
    }
  });

  it('returns empty matches for fully unrelated text', async () => {
    const r = await matchError({ text: 'completely unrelated random words' });
    if ('ok' in r && r.ok) {
      assert.equal(r.matches.length, 0);
    }
  });

  it('returns ok:false on missing text', async () => {
    const r = await matchError({ text: '' });
    assert.equal('ok' in r && r.ok, false);
  });

  it('respects the limit argument', async () => {
    const r = await matchError({
      text: 'pandas dtype mismatch bash local exit pthread race',
      limit: 1,
    });
    if ('ok' in r && r.ok) {
      assert.equal(r.matches.length, 1);
    }
  });

  it('exposes the matched tokens per result', async () => {
    const r = await matchError({ text: 'dtype mismatch' });
    if ('ok' in r && r.ok && r.matches.length > 0) {
      const top = r.matches[0]!;
      const tokens = top.matched.map((m) => m.token);
      assert.ok(tokens.includes('dtype') || tokens.includes('mismatch'));
    }
  });

  // Phase 7 A5 — accuracy improvements (synonym, fuzzy, multi-lang stopwords).

  it('expands "data type" → datatype → dtype via synonym table', async () => {
    const r = await matchError({
      text: 'pandas DataFrame has a data type mismatch',
    });
    assert.equal('ok' in r && r.ok, true);
    if ('ok' in r && r.ok) {
      assert.equal(r.matches[0]!.recipe.slug, 'pandas-56679');
      const dtypeMatch = r.matches[0]!.matched.find(
        (m) => m.token === 'dtype' && m.source === 'symptom',
      );
      assert.ok(dtypeMatch, 'expected dtype symptom match via synonym');
      assert.equal(dtypeMatch!.via, 'synonym');
      assert.equal(dtypeMatch!.input, 'datatype');
    }
  });

  it('matches typos via fuzzy distance-1 (e.g. missmatch → mismatch)', async () => {
    const r = await matchError({
      text: 'pandas dtype missmatch error',
    });
    assert.equal('ok' in r && r.ok, true);
    if ('ok' in r && r.ok) {
      assert.equal(r.matches[0]!.recipe.slug, 'pandas-56679');
      const fuzzyHit = r.matches[0]!.matched.find(
        (m) => m.token === 'mismatch' && m.via === 'fuzzy',
      );
      assert.ok(fuzzyHit, 'expected fuzzy match for mismatch');
      assert.equal(fuzzyHit!.input, 'missmatch');
    }
  });

  it('does not fuzzy-match short tokens (length < 6)', async () => {
    // 'dtype' is 5 chars, below FUZZY_MIN_LEN. A typo "dtyp" must NOT
    // accidentally match — would be too noisy.
    const r = await matchError({ text: 'pandas dtyp error' });
    if ('ok' in r && r.ok && r.matches.length > 0) {
      const dtypeFuzzy = r.matches[0]!.matched.find(
        (m) => m.token === 'dtype' && m.via === 'fuzzy',
      );
      assert.equal(dtypeFuzzy, undefined);
    }
  });

  it('drops German stopwords ("der", "fehler") so they cannot match accidentally', async () => {
    // "fehler" is added to the German stopword set; it must not appear
    // as a query token even though it would otherwise pass length / regex.
    const r = await matchError({
      text: 'der fehler ist ein dtype mismatch',
    });
    assert.equal('ok' in r && r.ok, true);
    if ('ok' in r && r.ok) {
      // Should still match pandas via the surviving tokens.
      assert.equal(r.matches[0]!.recipe.slug, 'pandas-56679');
      assert.ok(
        r.matches[0]!.matched.every((m) => m.token !== 'fehler'),
        'fehler should have been stopworded out',
      );
    }
  });

  it('marks exact matches without via (v1 wire-compat for non-fuzzy hits)', async () => {
    const r = await matchError({ text: 'pandas dtype mismatch' });
    if ('ok' in r && r.ok && r.matches.length > 0) {
      const exactSymptom = r.matches[0]!.matched.find(
        (m) => m.token === 'dtype' && m.source === 'symptom',
      );
      assert.ok(exactSymptom);
      // Direct exact hit — `via` and `input` must be absent.
      assert.equal(exactSymptom!.via, undefined);
      assert.equal(exactSymptom!.input, undefined);
    }
  });
});

describe('verify_branch_fix', () => {
  it('returns ok:false on missing slug', async () => {
    const r = await verifyBranchFix({ slug: '' });
    assert.equal(r.ok, false);
  });

  it('returns ok:false on unknown slug', async () => {
    const r = await verifyBranchFix({ slug: 'nonexistent-recipe' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not found/);
  });

  it('rejects fix_url + fix_source supplied together', async () => {
    const r = await verifyBranchFix({
      slug: 'pandas-56679',
      fix_url: 'https://example.invalid/fix.py',
      fix_source: 'print("fix")',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /mutually exclusive/);
  });

  it('rejects fix_source larger than 4 KiB', async () => {
    const big = 'x'.repeat(5000);
    const r = await verifyBranchFix({ slug: 'pandas-56679', fix_source: big });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /4096-byte inline limit/);
  });

  it('Layer 1 → path A, no fix supplied → notes the manual paste flow', async () => {
    const r = await verifyBranchFix({ slug: 'pandas-56679' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.path, 'A');
      assert.equal(r.layer, 1);
      assert.equal(r.compare_url, 'https://example.invalid/repro/pandas/56679/');
      assert.equal(r.gh_command, undefined);
      assert.match(r.instructions, /paste the candidate fix/);
      assert.ok(
        r.notes.some((n) => /no fix_url or fix_source supplied/.test(n)),
      );
    }
  });

  it('Layer 1 → path A with fix_url embeds it in compare_url', async () => {
    const r = await verifyBranchFix({
      slug: 'pandas-56679',
      fix_url: 'https://raw.githubusercontent.com/user/fork/branch/repro.py',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.match(r.compare_url, /[?&]fix_url=https/);
      assert.match(r.instructions, /pre-loaded/);
    }
  });

  it('Layer 1 → path A with fix_source base64url-encodes it as ?fix=', async () => {
    const r = await verifyBranchFix({
      slug: 'pandas-56679',
      fix_source: 'print("fixed")',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      const u = new URL(r.compare_url);
      const fix = u.searchParams.get('fix');
      assert.ok(fix, 'fix param should be present');
      // Decode and check.
      const padded = fix!.replace(/-/g, '+').replace(/_/g, '/');
      const padLen = (4 - (padded.length % 4)) % 4;
      const b64 = padded + '='.repeat(padLen);
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      assert.equal(decoded, 'print("fixed")');
    }
  });

  it('Layer 2 → path B returns gh_command and ignores fix_source', async () => {
    const r = await verifyBranchFix({
      slug: 'bash-local-shadows-exit',
      fix_source: 'echo not used on layer 2',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.path, 'B');
      assert.equal(r.layer, 2);
      assert.match(r.gh_command!, /gh workflow run branch-fix-verdict\.yml/);
      assert.match(r.gh_command!, /-f slug=bash-local-shadows-exit/);
      assert.match(r.compare_url, /\/repro\/compare\?slug=bash-local-shadows-exit/);
      assert.ok(
        r.notes.some((n) => /ignored for Layer 2\/3/.test(n)),
      );
    }
  });

  it('Layer 3 → path B', async () => {
    const r = await verifyBranchFix({ slug: 'lost-update' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.path, 'B');
      assert.equal(r.layer, 3);
      assert.match(r.gh_command!, /-f slug=lost-update/);
    }
  });
});

describe('prepare_new_recipe', () => {
  it('layer 2 default — composes scaffold + verify commands and rows', async () => {
    const r = await prepareNewRecipe({
      project: 'node',
      issue: 63041,
      title: "Intl.DateTimeFormat drops month with calendar:'iso8601'",
      base_image: 'node:26-slim',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.slug, 'node-63041');
      assert.equal(r.layer, 2);
      assert.equal(
        r.upstream_issue_url,
        'https://github.com/nodejs/node/issues/63041',
      );
      assert.match(r.scaffold_command, /^mise run recipes:new --/);
      assert.match(r.scaffold_command, /node 63041/);
      assert.match(r.scaffold_command, /--base "node:26-slim"/);
      assert.equal(r.verify_command, 'mise run recipes:verify -- node-63041');
      assert.equal(r.recipe_facets_row.key, 'node-63041');
      assert.equal(r.projects_row.key, 'node');
      assert.equal(
        r.projects_row.value.github,
        'https://github.com/nodejs/node',
      );
      assert.equal(
        r.commit_subject,
        'feat(layer2): node-63041 reproduction (...)',
      );
      assert.ok(r.next_steps.length > 0);
    }
  });

  it('layer 1 — uses feat(wasm) scope and notes the missing scaffolder', async () => {
    const r = await prepareNewRecipe({
      project: 'cpython',
      issue: 12345,
      title: 'something',
      layer: 1,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 1);
      assert.match(r.commit_subject, /^feat\(wasm\):/);
      assert.match(r.scaffold_command, /^# No scaffolder for Layer 1/);
      assert.match(r.verify_command, /^# No verifier for Layer 1/);
      assert.equal(
        r.upstream_issue_url,
        'https://github.com/python/cpython/issues/12345',
      );
    }
  });

  it('layer 3 — uses feat(layer3) scope', async () => {
    const r = await prepareNewRecipe({
      project: 'pthread',
      issue: 999,
      title: 'race',
      layer: 3,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 3);
      assert.match(r.commit_subject, /^feat\(layer3\):/);
    }
  });

  it('rejects slugs that the recipes-index parser would not resolve', async () => {
    // Underscore is not in [a-z0-9-]+ for the slug parser; "my_proj"
    // produces an unparseable slug.
    const r = await prepareNewRecipe({
      project: 'my_proj',
      issue: 63041,
      title: 'x',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /not parseable/);
    }
  });

  it('rejects non-positive issue numbers', async () => {
    const r = await prepareNewRecipe({
      project: 'node',
      issue: 0,
      title: 'x',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /positive integer/);
    }
  });

  it('repo_owner override only forwarded to scaffold cmd when it differs from the default', async () => {
    const heuristic = await prepareNewRecipe({
      project: 'node',
      issue: 1,
      title: 't',
      repo_owner: 'nodejs/node',
    });
    assert.equal(heuristic.ok, true);
    if (heuristic.ok) {
      assert.ok(
        !heuristic.scaffold_command.includes('--repo'),
        'should not redundantly pass --repo when it matches the default',
      );
    }
    const overridden = await prepareNewRecipe({
      project: 'foo',
      issue: 1,
      title: 't',
      repo_owner: 'someorg/foo',
    });
    assert.equal(overridden.ok, true);
    if (overridden.ok) {
      assert.match(overridden.scaffold_command, /--repo someorg\/foo/);
    }
  });

  it('falls back to <project>/<project> for unknown projects', async () => {
    const r = await prepareNewRecipe({
      project: 'mystery',
      issue: 42,
      title: 'x',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(
        r.upstream_issue_url,
        'https://github.com/mystery/mystery/issues/42',
      );
    }
  });
});

describe('prepare_fix_candidate', () => {
  it('happy path — Layer 1 slug + valid fork URL + branch', async () => {
    const r = await prepareFixCandidate({
      slug: 'pandas-56679',
      fork_url: 'https://github.com/example-fork/pandas',
      branch: 'fix/56679-empty-series',
      upstream_pr: 'https://github.com/example-fork/pandas/pull/1',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.slug, 'pandas-56679');
      assert.equal(r.layer, 1);
      assert.equal(
        r.fix_candidate_path,
        'src/layer1_wasm/pandas-56679/fix-candidate.json',
      );
      assert.equal(r.fix_candidate_json.schema_version, 1);
      assert.equal(r.fix_candidate_json.package, 'pandas');
      assert.equal(
        r.fix_candidate_json.source.url,
        'https://github.com/example-fork/pandas',
      );
      assert.equal(r.fix_candidate_json.source.ref, 'fix/56679-empty-series');
      assert.equal(
        r.fix_candidate_json.upstream_pr,
        'https://github.com/example-fork/pandas/pull/1',
      );
      assert.match(r.commit_subject, /^feat\(wasm\): register fix-candidate for pandas-56679$/);
      assert.match(r.pr_title, /^feat\(wasm\): register fix-candidate for pandas-56679$/);
      assert.equal(r.branch_name, 'register-fix-candidate-pandas-56679');
      assert.match(r.pr_body, /<details>/);
      assert.match(r.pr_body, /Generated with \[Claude Code\]/);
      assert.ok(
        r.commands.some((c) =>
          c.includes('gh pr create --repo aletheia-works/vivarium'),
        ),
        'commands should include gh pr create',
      );
      assert.ok(
        r.commands.some((c) =>
          c.includes('cat > src/layer1_wasm/pandas-56679/fix-candidate.json'),
        ),
        'commands should include the cat heredoc for the spec file',
      );
    }
  });

  it('omits upstream_pr from JSON when not provided', async () => {
    const r = await prepareFixCandidate({
      slug: 'pandas-56679',
      fork_url: 'https://github.com/example-fork/pandas',
      branch: 'fix/56679',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.fix_candidate_json.upstream_pr, undefined);
      // PR body should not have an "Upstream PR:" line either.
      assert.equal(r.pr_body.includes('Upstream PR:'), false);
    }
  });

  it('package override wins over the catalogue project name', async () => {
    const r = await prepareFixCandidate({
      slug: 'pandas-56679',
      fork_url: 'https://github.com/example-fork/pandas',
      branch: 'main',
      package: 'pandas-stubs',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.fix_candidate_json.package, 'pandas-stubs');
    }
  });

  it('returns ok:false on missing slug', async () => {
    const r = await prepareFixCandidate({
      slug: '',
      fork_url: 'https://github.com/example-fork/pandas',
      branch: 'main',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /slug is required/);
  });

  it('returns ok:false on missing fork_url', async () => {
    const r = await prepareFixCandidate({
      slug: 'pandas-56679',
      fork_url: '',
      branch: 'main',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /fork_url is required/);
  });

  it('returns ok:false on missing branch', async () => {
    const r = await prepareFixCandidate({
      slug: 'pandas-56679',
      fork_url: 'https://github.com/example-fork/pandas',
      branch: '',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /branch is required/);
  });

  it('rejects fork_url that is not a bare GitHub repo URL (tree / blob / pull)', async () => {
    const r = await prepareFixCandidate({
      slug: 'pandas-56679',
      fork_url: 'https://github.com/example-fork/pandas/tree/main',
      branch: 'main',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /bare GitHub repo URL/);
  });

  it('returns ok:false on unknown slug', async () => {
    const r = await prepareFixCandidate({
      slug: 'does-not-exist',
      fork_url: 'https://github.com/example-fork/pandas',
      branch: 'main',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not found in the recipe catalogue/);
  });

  it('rejects non-Layer-1 slugs (Layers 2/3 use verify_branch_fix instead)', async () => {
    const r = await prepareFixCandidate({
      slug: 'bash-local-shadows-exit',
      fork_url: 'https://github.com/example-fork/bash',
      branch: 'main',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /only wired up for Layer 1/);
      assert.match(r.error, /verify_branch_fix/);
    }
  });

  it('strips a trailing slash from fork_url', async () => {
    const r = await prepareFixCandidate({
      slug: 'pandas-56679',
      fork_url: 'https://github.com/example-fork/pandas/',
      branch: 'main',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(
        r.fix_candidate_json.source.url,
        'https://github.com/example-fork/pandas',
      );
    }
  });
});
