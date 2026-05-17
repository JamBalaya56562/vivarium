// Tool-level smoke tests. Stub fetch with a fixture catalogue and
// exercise list_recipes / get_recipe / lookup_verdict's branching.

import { afterEach, beforeEach, describe, it } from 'bun:test';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { _resetCacheForTesting, INDEX_URL } from '../src/catalogue.ts';
import {
  _setGhRunnerForTesting as _setCreateForkPrGhRunnerForTesting,
  createForkPr,
} from '../src/tools/create_fork_pr.ts';
import { getRecipe } from '../src/tools/get_recipe.ts';
import { listRecipes } from '../src/tools/list_recipes.ts';
import { lookupVerdict } from '../src/tools/lookup_verdict.ts';
import { matchError } from '../src/tools/match_error.ts';
import { prepareFixCandidate } from '../src/tools/prepare_fix_candidate.ts';
import { prepareNewRecipe } from '../src/tools/prepare_new_recipe.ts';
import {
  _setSpawnRunnerForTesting,
  _setVerdictReaderForTesting,
  runLayer1Verdict,
} from '../src/tools/run_layer1_verdict.ts';
import {
  _setGhRunnerForTesting as _setLayer23GhRunnerForTesting,
  _setSleeperForTesting,
  _setSnapshotFetcherForTesting,
  runLayer23Verdict,
} from '../src/tools/run_layer23_verdict.ts';
import {
  _setGhRunnerForTesting,
  type GhRunResult,
  searchUpstreamIssues,
} from '../src/tools/search_upstream_issues.ts';
import {
  computeNextAction,
  parseUpstreamIssue,
  verifyAndReportFix,
} from '../src/tools/verify_and_report_fix.ts';
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
  _setGhRunnerForTesting(null);
  _setSpawnRunnerForTesting(null);
  _setVerdictReaderForTesting(null);
  _setLayer23GhRunnerForTesting(null);
  _setSnapshotFetcherForTesting(null);
  _setSleeperForTesting(null);
  _setCreateForkPrGhRunnerForTesting(null);
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

describe('computeNextAction (state machine)', () => {
  it('returns verify_unfixed when state is undefined (fresh round-trip)', () => {
    assert.equal(computeNextAction(undefined), 'verify_unfixed');
  });

  it('returns verify_unfixed when only status=draft is present', () => {
    assert.equal(computeNextAction({ status: 'draft' }), 'verify_unfixed');
  });

  it('returns verify_fixed once unfixed=reproduced is captured', () => {
    assert.equal(
      computeNextAction({
        status: 'verifying',
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
        },
      }),
      'verify_fixed',
    );
  });

  it('returns open_vivarium_pr when both verdicts proper polarity and no vivarium_pr', () => {
    assert.equal(
      computeNextAction({
        status: 'verified',
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
          fixed: {
            verdict: 'unreproduced',
            captured_at: '2026-05-17T00:10:00Z',
            source: 'layer1-headless',
          },
        },
      }),
      'open_vivarium_pr',
    );
  });

  it('returns open_fork_pr once vivarium_pr is recorded', () => {
    assert.equal(
      computeNextAction({
        status: 'verified',
        vivarium_pr: 'https://github.com/aletheia-works/vivarium/pull/200',
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
          fixed: {
            verdict: 'unreproduced',
            captured_at: '2026-05-17T00:10:00Z',
            source: 'layer1-headless',
          },
        },
      }),
      'open_fork_pr',
    );
  });

  it('returns complete once upstream_pr is opened', () => {
    assert.equal(
      computeNextAction({
        status: 'upstream_open',
        upstream_pr: 'https://github.com/mpmath/mpmath/pull/984',
      }),
      'complete',
    );
  });

  it('returns complete once status=merged regardless of other fields', () => {
    assert.equal(computeNextAction({ status: 'merged' }), 'complete');
  });

  it('returns manual_intervention when status=blocked, even if verdicts look verified', () => {
    // status: blocked is a tombstone — automation must stop until a
    // human resolves it, regardless of how progressed other fields look.
    assert.equal(
      computeNextAction({
        status: 'blocked',
        vivarium_pr: 'https://github.com/aletheia-works/vivarium/pull/200',
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
          fixed: {
            verdict: 'unreproduced',
            captured_at: '2026-05-17T00:10:00Z',
            source: 'layer1-headless',
          },
        },
      }),
      'manual_intervention',
    );
  });
});

describe('parseUpstreamIssue', () => {
  it('extracts owner/repo from a canonical github.com issue URL', () => {
    assert.deepEqual(
      parseUpstreamIssue('https://github.com/pandas-dev/pandas/issues/56679'),
      { owner: 'pandas-dev', repo: 'pandas' },
    );
  });

  it('also accepts the /pull/<n> form', () => {
    assert.deepEqual(
      parseUpstreamIssue('https://github.com/mpmath/mpmath/pull/984'),
      { owner: 'mpmath', repo: 'mpmath' },
    );
  });

  it('returns undefined for non-github hosts', () => {
    assert.equal(
      parseUpstreamIssue('https://gitlab.com/foo/bar/-/issues/1'),
      undefined,
    );
  });

  it('returns undefined for malformed URLs', () => {
    assert.equal(parseUpstreamIssue('not a url'), undefined);
    assert.equal(parseUpstreamIssue(''), undefined);
    assert.equal(parseUpstreamIssue(undefined), undefined);
  });

  it('returns undefined for github URLs missing the issues/pull segment', () => {
    assert.equal(
      parseUpstreamIssue('https://github.com/pandas-dev/pandas'),
      undefined,
    );
  });
});

describe('verify_and_report_fix', () => {
  it('returns ok:false on missing slug', async () => {
    const r = await verifyAndReportFix({ slug: '' });
    assert.equal(r.ok, false);
  });

  it('returns ok:false on unknown slug', async () => {
    const r = await verifyAndReportFix({ slug: 'nonexistent-recipe' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not found/);
  });

  it('Layer 1 + no state → next_action=verify_unfixed, path A, layer1_wasm roundtrip_path', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      auto_execute: false,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 1);
      assert.equal(r.path, 'A');
      assert.equal(r.next_action, 'verify_unfixed');
      assert.equal(
        r.roundtrip_path,
        'src/layer1_wasm/pandas-56679/roundtrip.json',
      );
      assert.ok(
        r.commands.some((c) => c.includes('bun x playwright test')),
        'layer 1 verify_unfixed commands should include playwright invocation',
      );
    }
  });

  it('Layer 2 + no state → next_action=verify_unfixed, path B, mise recipes:verify', async () => {
    const r = await verifyAndReportFix({
      slug: 'bash-local-shadows-exit',
      auto_execute: false,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 2);
      assert.equal(r.path, 'B');
      assert.equal(r.next_action, 'verify_unfixed');
      assert.equal(
        r.roundtrip_path,
        'src/layer2_docker/bash-local-shadows-exit/roundtrip.json',
      );
      assert.ok(
        r.commands.some((c) =>
          c.includes('mise run recipes:verify bash-local-shadows-exit'),
        ),
      );
    }
  });

  it('Layer 3 + no state → roundtrip_path under layer3_thirdway', async () => {
    const r = await verifyAndReportFix({
      slug: 'lost-update',
      auto_execute: false,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 3);
      assert.equal(
        r.roundtrip_path,
        'src/layer3_thirdway/lost-update/roundtrip.json',
      );
    }
  });

  it('verified state without vivarium_pr → next_action=open_vivarium_pr + sl pr submit', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      auto_execute: false,
      current_state: {
        status: 'verified',
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
          fixed: {
            verdict: 'unreproduced',
            captured_at: '2026-05-17T00:10:00Z',
            source: 'layer1-headless',
          },
        },
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.next_action, 'open_vivarium_pr');
      assert.ok(r.commands.some((c) => c === 'sl pr submit'));
    }
  });

  it('verified + vivarium_pr + fork → open_fork_pr targets upstream repo, not fork', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      auto_execute: false,
      current_state: {
        status: 'verified',
        upstream_issue: 'https://github.com/pandas-dev/pandas/issues/56679',
        vivarium_pr: 'https://github.com/aletheia-works/vivarium/pull/200',
        fork: {
          owner: 'JamBalaya56562',
          repo: 'pandas',
          branch: 'fix-issue-56679',
        },
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
          fixed: {
            verdict: 'unreproduced',
            captured_at: '2026-05-17T00:10:00Z',
            source: 'layer1-headless',
          },
        },
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.next_action, 'open_fork_pr');
      const ghCmd = r.commands.find((c) => c.startsWith('gh pr create'));
      assert.ok(ghCmd, 'open_fork_pr commands should contain a gh pr create line');
      // The PR's base repo MUST be the upstream owner/repo derived from
      // upstream_issue, not the contributor's fork. --head still points
      // at the fork's branch.
      assert.match(ghCmd!, /--repo pandas-dev\/pandas/);
      assert.match(ghCmd!, /--head JamBalaya56562:fix-issue-56679/);
      assert.ok(
        !/--repo JamBalaya56562\/pandas/.test(ghCmd!),
        '--repo must NOT be the fork repo',
      );
      assert.match(ghCmd!, /--draft/);
      assert.match(ghCmd!, /--label 'ai: generated'/);
    }
  });

  it('open_fork_pr without upstream_issue surfaces a warning comment instead of executing', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      auto_execute: false,
      current_state: {
        status: 'verified',
        vivarium_pr: 'https://github.com/aletheia-works/vivarium/pull/200',
        fork: {
          owner: 'JamBalaya56562',
          repo: 'pandas',
          branch: 'fix-issue-56679',
        },
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
          fixed: {
            verdict: 'unreproduced',
            captured_at: '2026-05-17T00:10:00Z',
            source: 'layer1-headless',
          },
        },
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.next_action, 'open_fork_pr');
      assert.ok(
        !r.commands.some((c) => c.startsWith('gh pr create')),
        'should NOT emit gh pr create when upstream cannot be derived',
      );
      assert.ok(
        r.commands.some((c) => /Cannot derive upstream repo/.test(c)),
        'should explain why the command was suppressed',
      );
    }
  });

  it('blocked state → next_action=manual_intervention with stop-the-line commands', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      auto_execute: false,
      current_state: {
        status: 'blocked',
        notes: ['upstream maintainer rejected the fix approach'],
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.next_action, 'manual_intervention');
      assert.ok(
        r.commands.some((c) => /status=blocked/.test(c)),
        'commands should annotate that the round-trip is paused',
      );
      assert.ok(
        !r.commands.some((c) => c.startsWith('gh ') || c.startsWith('sl ')),
        'manual_intervention must NOT emit executable commands',
      );
    }
  });

  it('upstream_pr present → next_action=complete + empty commands', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      auto_execute: false,
      current_state: {
        status: 'upstream_open',
        upstream_pr: 'https://github.com/pandas-dev/pandas/pull/12345',
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.next_action, 'complete');
      assert.equal(r.commands.length, 0);
    }
  });
});

describe('verify_and_report_fix auto-execute (Phase 3)', () => {
  it('Layer 1 + auto_execute=true → spawns Playwright and merges captured verdict', async () => {
    _setSpawnRunnerForTesting(() => ({ status: 0, stdout: '', stderr: '' }));
    _setVerdictReaderForTesting(() =>
      JSON.stringify({
        slug: 'pandas-56679',
        verdict: 'reproduced',
        fix_url: null,
        captured_at: '2026-05-17T10:00:00Z',
      }),
    );

    const r = await verifyAndReportFix({ slug: 'pandas-56679' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.executed?.action, 'verify_unfixed');
      assert.equal(r.executed?.ok, true);
      assert.equal(r.executed?.source, 'layer1-headless');
      assert.equal(r.verdicts.unfixed?.verdict, 'reproduced');
      // After capturing unfixed=reproduced, the next action becomes
      // verify_fixed (the state machine advanced one step).
      assert.equal(r.next_action, 'verify_fixed');
    }
  });

  it('Layer 1 + verify_fixed without fix_url → executed.ok=false, no verdict merged', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      current_state: {
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
        },
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.executed?.action, 'verify_fixed');
      assert.equal(r.executed?.ok, false);
      assert.match(r.executed?.error ?? '', /fix_url is required/);
      assert.equal(r.verdicts.fixed, undefined);
    }
  });

  it('Layer 1 + auto_execute=true + spawn failure surfaces in executed', async () => {
    _setSpawnRunnerForTesting(() => ({
      status: 1,
      stdout: '',
      stderr: 'Playwright crashed',
    }));

    const r = await verifyAndReportFix({ slug: 'pandas-56679' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.executed?.ok, false);
      assert.match(r.executed?.error ?? '', /status 1/);
      assert.equal(r.verdicts.unfixed, undefined);
    }
  });

  it('Layer 3 + verify_fixed → executed.ok=false (workflow does not yet support Layer 3)', async () => {
    // lost-update is Layer 3. Force the state machine to verify_fixed
    // by supplying an unfixed=reproduced verdict, then check the
    // executor rejects with an informative error rather than dispatching
    // a workflow that would fail inside branch-fix-verdict.yml.
    let ghCalled = false;
    _setLayer23GhRunnerForTesting(() => {
      ghCalled = true;
      return { status: 0, stdout: '', stderr: '' };
    });

    const r = await verifyAndReportFix({
      slug: 'lost-update',
      branch_image: 'ghcr.io/test/lost-update:fix',
      current_state: {
        verdicts: {
          unfixed: {
            verdict: 'reproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer3-trace',
          },
        },
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.layer, 3);
      assert.equal(r.executed?.action, 'verify_fixed');
      assert.equal(r.executed?.ok, false);
      assert.match(r.executed?.error ?? '', /not yet supported for Layer 3/);
      assert.equal(r.verdicts.fixed, undefined);
      assert.equal(ghCalled, false, 'gh must NOT be called when Layer 3 verify_fixed is rejected');
    }
  });

  it('Layer 2 + auto_execute=true → fetches deployed snapshot for unfixed', async () => {
    _setSnapshotFetcherForTesting(async (slug) => ({
      contract: 'v1',
      verdict: 'reproduced',
      exit_code: 0,
      image_tag: `vivarium-${slug}:test`,
      image_digest: 'sha256:test',
      captured_at: '2026-05-17T10:00:00Z',
      stdout: '',
      stderr_tail: '',
    }));

    const r = await verifyAndReportFix({ slug: 'bash-local-shadows-exit' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.executed?.action, 'verify_unfixed');
      assert.equal(r.executed?.ok, true);
      assert.equal(r.executed?.source, 'layer2-ghcr');
      assert.equal(r.verdicts.unfixed?.verdict, 'reproduced');
    }
  });

  it('auto_execute=false → no execution, no executed field', async () => {
    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      auto_execute: false,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.executed, undefined);
      assert.equal(r.verdicts.unfixed, undefined);
    }
  });

  it('open_*_pr / complete / manual_intervention next actions skip execution', async () => {
    // status=blocked → manual_intervention. auto_execute=true should
    // NOT trigger any spawn/gh call because those actions are not
    // executable verify steps.
    let spawnCalled = false;
    _setSpawnRunnerForTesting(() => {
      spawnCalled = true;
      return { status: 0, stdout: '', stderr: '' };
    });

    const r = await verifyAndReportFix({
      slug: 'pandas-56679',
      current_state: { status: 'blocked' },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.next_action, 'manual_intervention');
      assert.equal(r.executed, undefined);
      assert.equal(spawnCalled, false);
    }
  });
});

describe('run_layer1_verdict', () => {
  it('returns ok:false on missing slug', async () => {
    const r = await runLayer1Verdict({ slug: '' });
    assert.equal(r.ok, false);
  });

  it('passes PLAYWRIGHT_FIX_URL through env when fix_url is supplied', async () => {
    let capturedEnv: NodeJS.ProcessEnv = {};
    _setSpawnRunnerForTesting(({ env }) => {
      capturedEnv = env;
      return { status: 0, stdout: '', stderr: '' };
    });
    _setVerdictReaderForTesting(() =>
      JSON.stringify({
        slug: 'pandas-56679',
        verdict: 'unreproduced',
        fix_url: 'https://example.invalid/fix.py',
        captured_at: '2026-05-17T10:00:00Z',
      }),
    );

    const r = await runLayer1Verdict({
      slug: 'pandas-56679',
      fix_url: 'https://example.invalid/fix.py',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.verdict, 'unreproduced');
      assert.equal(r.fix_url, 'https://example.invalid/fix.py');
    }
    assert.equal(
      capturedEnv['PLAYWRIGHT_FIX_URL'],
      'https://example.invalid/fix.py',
    );
  });

  it('targets the recipe via `--grep "verdict-capture: <slug>"`', async () => {
    let capturedArgs: string[] = [];
    _setSpawnRunnerForTesting(({ args }) => {
      capturedArgs = args;
      return { status: 0, stdout: '', stderr: '' };
    });
    _setVerdictReaderForTesting(() =>
      JSON.stringify({
        slug: 'pandas-56679',
        verdict: 'reproduced',
        fix_url: null,
        captured_at: '2026-05-17T10:00:00Z',
      }),
    );

    await runLayer1Verdict({ slug: 'pandas-56679' });
    const grepIdx = capturedArgs.indexOf('--grep');
    assert.ok(grepIdx >= 0);
    assert.equal(capturedArgs[grepIdx + 1], 'verdict-capture: pandas-56679');
  });

  it('returns ok:false when spawn exits non-zero', async () => {
    _setSpawnRunnerForTesting(() => ({
      status: 1,
      stdout: '',
      stderr: 'Playwright failed',
    }));
    const r = await runLayer1Verdict({ slug: 'pandas-56679' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /status 1/);
      assert.equal(r.stderr_tail, 'Playwright failed');
    }
  });

  it('returns ok:false when verdict output is malformed JSON', async () => {
    _setSpawnRunnerForTesting(() => ({ status: 0, stdout: '', stderr: '' }));
    _setVerdictReaderForTesting(() => 'not-json');
    const r = await runLayer1Verdict({ slug: 'pandas-56679' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not valid JSON/);
  });

  it('returns ok:false when slug in output does not match request', async () => {
    _setSpawnRunnerForTesting(() => ({ status: 0, stdout: '', stderr: '' }));
    _setVerdictReaderForTesting(() =>
      JSON.stringify({
        slug: 'wrong-slug',
        verdict: 'reproduced',
        fix_url: null,
        captured_at: '2026-05-17T10:00:00Z',
      }),
    );
    const r = await runLayer1Verdict({ slug: 'pandas-56679' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /does not match/);
  });
});

describe('run_layer23_verdict', () => {
  it('returns ok:false on missing slug', async () => {
    const r = await runLayer23Verdict({ slug: '', mode: 'unfixed' });
    assert.equal(r.ok, false);
  });

  it('returns ok:false on invalid mode', async () => {
    const r = await runLayer23Verdict({
      slug: 'bash-local-shadows-exit',
      mode: 'bogus' as 'unfixed',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /invalid mode/);
  });

  it('mode=unfixed → fetches deployed snapshot via injected fetcher', async () => {
    _setSnapshotFetcherForTesting(async (slug) => ({
      contract: 'v1',
      verdict: 'reproduced',
      exit_code: 0,
      image_tag: `vivarium-${slug}:dev`,
      image_digest: 'sha256:test',
      captured_at: '2026-05-17T10:00:00Z',
      stdout: '',
      stderr_tail: '',
    }));
    const r = await runLayer23Verdict({
      slug: 'bash-local-shadows-exit',
      mode: 'unfixed',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.verdict, 'reproduced');
      assert.equal(r.source, 'deployed-snapshot');
      assert.equal(r.mode, 'unfixed');
    }
  });

  it('mode=unfixed returns ok:false when no snapshot exists', async () => {
    _setSnapshotFetcherForTesting(async () => null);
    const r = await runLayer23Verdict({
      slug: 'pandas-56679',
      mode: 'unfixed',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no deployed verdict/);
  });

  it('mode=fixed requires branch_image', async () => {
    const r = await runLayer23Verdict({
      slug: 'bash-local-shadows-exit',
      mode: 'fixed',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /branch_image is required/);
  });

  it('mode=fixed → dispatches workflow, polls, downloads artefact', async () => {
    _setSleeperForTesting(async () => {
      /* skip waits */
    });

    let viewCount = 0;
    _setLayer23GhRunnerForTesting((args) => {
      const cmd = args[0];
      const sub = args[1];

      if (cmd === 'workflow' && sub === 'run') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'run' && sub === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              databaseId: 9999,
              status: 'queued',
              createdAt: '2026-05-17T10:00:00Z',
            },
          ]),
          stderr: '',
        };
      }
      if (cmd === 'run' && sub === 'view') {
        viewCount++;
        // First poll: still running. Second poll: completed.
        if (viewCount === 1) {
          return {
            status: 0,
            stdout: JSON.stringify({
              status: 'in_progress',
              conclusion: null,
            }),
            stderr: '',
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            status: 'completed',
            conclusion: 'success',
          }),
          stderr: '',
        };
      }
      if (cmd === 'run' && sub === 'download') {
        const dirIdx = args.indexOf('--dir');
        const dir = args[dirIdx + 1]!;
        const verdictPath = join(dir, 'branch-fix-verdict.json');
        writeFileSync(
          verdictPath,
          JSON.stringify({
            contract: 'v1',
            verdict: 'unreproduced',
            exit_code: 0,
            image_tag: 'ghcr.io/test/image:fix',
            image_digest: 'sha256:test',
            captured_at: '2026-05-17T10:05:00Z',
            stdout: '',
            stderr_tail: '',
          }),
          'utf-8',
        );
        return { status: 0, stdout: '', stderr: '' };
      }
      return {
        status: 1,
        stdout: '',
        stderr: `unexpected gh call: ${args.join(' ')}`,
      };
    });

    const r = await runLayer23Verdict({
      slug: 'bash-local-shadows-exit',
      mode: 'fixed',
      branch_image: 'ghcr.io/test/image:fix',
      poll_interval_ms: 1,
      poll_timeout_ms: 5000,
    });

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.verdict, 'unreproduced');
      assert.equal(r.source, 'workflow-artefact');
      assert.equal(r.workflow_run_id, 9999);
      assert.equal(r.mode, 'fixed');
    }
  });

  it('mode=fixed → picks the post-dispatch run when older runs precede it', async () => {
    _setSleeperForTesting(async () => {
      /* skip waits */
    });

    // gh run list returns 3 runs: two created before dispatch (stale)
    // and one created after. The implementation must filter by
    // createdAt and pick the post-dispatch one — NOT the most recent
    // overall (which would be `runs[0]`, an older queued run).
    _setLayer23GhRunnerForTesting((args) => {
      const cmd = args[0];
      const sub = args[1];
      if (cmd === 'workflow' && sub === 'run') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'run' && sub === 'list') {
        const now = Date.now();
        const stale1 = new Date(now - 60_000).toISOString();
        const stale2 = new Date(now - 30_000).toISOString();
        const ours = new Date(now + 1_000).toISOString();
        return {
          status: 0,
          stdout: JSON.stringify([
            { databaseId: 1111, status: 'queued', createdAt: stale1 },
            { databaseId: 2222, status: 'queued', createdAt: stale2 },
            { databaseId: 3333, status: 'queued', createdAt: ours },
          ]),
          stderr: '',
        };
      }
      if (cmd === 'run' && sub === 'view') {
        return {
          status: 0,
          stdout: JSON.stringify({
            status: 'completed',
            conclusion: 'success',
          }),
          stderr: '',
        };
      }
      if (cmd === 'run' && sub === 'download') {
        const dirIdx = args.indexOf('--dir');
        const dir = args[dirIdx + 1]!;
        writeFileSync(
          join(dir, 'branch-fix-verdict.json'),
          JSON.stringify({
            contract: 'v1',
            verdict: 'unreproduced',
            exit_code: 0,
            image_tag: 'ghcr.io/test/image:fix',
            image_digest: 'sha256:test',
            captured_at: '2026-05-17T10:05:00Z',
            stdout: '',
            stderr_tail: '',
          }),
          'utf-8',
        );
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const r = await runLayer23Verdict({
      slug: 'bash-local-shadows-exit',
      mode: 'fixed',
      branch_image: 'ghcr.io/test/image:fix',
      poll_interval_ms: 1,
      poll_timeout_ms: 5000,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      // 3333 is the only post-dispatch run; the older 1111 / 2222
      // must be ignored even though they appear first in the list.
      assert.equal(r.workflow_run_id, 3333);
    }
  });

  it('mode=fixed → ok:false when every returned run pre-dates the dispatch', async () => {
    _setSleeperForTesting(async () => {
      /* skip waits */
    });

    _setLayer23GhRunnerForTesting((args) => {
      const cmd = args[0];
      const sub = args[1];
      if (cmd === 'workflow' && sub === 'run') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'run' && sub === 'list') {
        const now = Date.now();
        // All runs are well before the dispatch + 5s buffer cutoff.
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              databaseId: 1111,
              status: 'queued',
              createdAt: new Date(now - 120_000).toISOString(),
            },
            {
              databaseId: 2222,
              status: 'queued',
              createdAt: new Date(now - 60_000).toISOString(),
            },
          ]),
          stderr: '',
        };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const r = await runLayer23Verdict({
      slug: 'bash-local-shadows-exit',
      mode: 'fixed',
      branch_image: 'ghcr.io/test/image:fix',
      poll_interval_ms: 1,
      poll_timeout_ms: 5000,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /at or after dispatch/);
      assert.match(r.error, /2 older run/);
    }
  });

  it('mode=fixed → reports workflow timeout when polling deadline elapses', async () => {
    _setSleeperForTesting(async () => {
      /* skip waits */
    });

    _setLayer23GhRunnerForTesting((args) => {
      const cmd = args[0];
      const sub = args[1];
      if (cmd === 'workflow' && sub === 'run') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'run' && sub === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              databaseId: 7777,
              status: 'queued',
              createdAt: '2026-05-17T10:00:00Z',
            },
          ]),
          stderr: '',
        };
      }
      if (cmd === 'run' && sub === 'view') {
        // Always still running — drives the loop to timeout.
        return {
          status: 0,
          stdout: JSON.stringify({
            status: 'in_progress',
            conclusion: null,
          }),
          stderr: '',
        };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const r = await runLayer23Verdict({
      slug: 'bash-local-shadows-exit',
      mode: 'fixed',
      branch_image: 'ghcr.io/test/image:fix',
      poll_interval_ms: 1,
      poll_timeout_ms: 50,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /did not complete within/);
      assert.equal(r.workflow_run_id, 7777);
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
      // roundtrip_init for the scaffold-recipe-from-issue skill to write.
      assert.equal(r.roundtrip_init.schema_version, 1);
      assert.equal(r.roundtrip_init.slug, 'node-63041');
      assert.equal(
        r.roundtrip_init.upstream_issue,
        'https://github.com/nodejs/node/issues/63041',
      );
      assert.equal(r.roundtrip_init.status, 'draft');
      assert.match(r.roundtrip_init.updated_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(r.roundtrip_init.notes, [
        'scaffolded from upstream issue',
      ]);
      assert.equal(
        r.roundtrip_path,
        'src/layer2_docker/node-63041/roundtrip.json',
      );
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
      assert.equal(
        r.roundtrip_path,
        'src/layer1_wasm/cpython-12345/roundtrip.json',
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

describe('search_upstream_issues', () => {
  // Build a gh-runner stub returning a fixture issue list. Returns the
  // last captured argv so tests can assert how gh was invoked.
  function stubGh(
    issues: unknown[],
    overrides: Partial<GhRunResult> = {},
  ): { capturedArgs: string[][] } {
    const capturedArgs: string[][] = [];
    _setGhRunnerForTesting((args) => {
      capturedArgs.push(args);
      return {
        status: 0,
        stdout: JSON.stringify(issues),
        stderr: '',
        ...overrides,
      };
    });
    return { capturedArgs };
  }

  it('returns ok:false when neither project nor repo is passed', async () => {
    const r = await searchUpstreamIssues({});
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /project or repo is required/);
  });

  it('rejects malformed repo shape', async () => {
    const r = await searchUpstreamIssues({ repo: 'not-a-valid-repo' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /owner\/repo/);
  });

  it('resolves project → default repo via the shared map', async () => {
    const { capturedArgs } = stubGh([]);
    const r = await searchUpstreamIssues({ project: 'node' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.repo, 'nodejs/node');
      // gh was called with --repo nodejs/node
      const repoIdx = capturedArgs[0]!.indexOf('--repo');
      assert.ok(repoIdx >= 0);
      assert.equal(capturedArgs[0]![repoIdx + 1], 'nodejs/node');
    }
  });

  it('strict policy short-circuits when the search repo is in exclude_repos (no gh call)', async () => {
    const { capturedArgs } = stubGh([
      {
        number: 1,
        title: 'x',
        url: '',
        body: '',
        repository: { nameWithOwner: 'example-org/skip-me' },
      },
    ]);
    const r = await searchUpstreamIssues({
      repo: 'example-org/skip-me',
      exclude_repos: ['example-org/skip-me'],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.count, 0);
      assert.equal(r.matches.length, 0);
      assert.equal(capturedArgs.length, 0, 'gh must NOT be called for excluded repos');
      assert.ok(r.notes.some((n) => /exclude_repos/.test(n)));
    }
  });

  it('strict policy appends `-linked:pr` after a `--` separator', async () => {
    // Without `--`, gh parses `-linked:pr` as a flag and fails with
    // `unknown shorthand flag: 'l' in -linked:pr`. The separator
    // forces the rest of argv to be treated as the search query.
    const { capturedArgs } = stubGh([]);
    await searchUpstreamIssues({ repo: 'nodejs/node' });
    const argv = capturedArgs[0]!;
    const sepIdx = argv.indexOf('--');
    assert.ok(sepIdx >= 0, '`--` separator must appear in argv');
    const afterSep = argv.slice(sepIdx + 1).join(' ');
    assert.match(afterSep, /-linked:pr/);
  });

  it('permissive policy omits `-linked:pr` and leaves has_pr unset', async () => {
    const { capturedArgs } = stubGh([
      {
        number: 42,
        title: 'foo',
        url: 'https://github.com/nodejs/node/issues/42',
        body: 'snippet body',
        labels: [{ name: 'bug' }],
        createdAt: '2026-05-01T00:00:00Z',
        state: 'open',
        repository: { nameWithOwner: 'nodejs/node' },
      },
    ]);
    const r = await searchUpstreamIssues({
      repo: 'nodejs/node',
      selection_policy: 'permissive',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.selection_policy, 'permissive');
      assert.equal(r.matches[0]!.has_pr, undefined);
      // No `-linked:pr` qualifier anywhere in argv; the `--` separator
      // also has nothing to guard, so it should be absent too.
      const argv = capturedArgs[0]!;
      assert.ok(
        !argv.some((a) => /-linked:pr/.test(a)),
        'permissive must NOT inject -linked:pr',
      );
      assert.ok(
        !argv.includes('--'),
        'permissive with no caller query must NOT emit a `--` separator',
      );
    }
  });

  it('parses gh issue JSON into SearchMatch shape', async () => {
    stubGh([
      {
        number: 12345,
        title: 'Intl.DateTimeFormat drops month',
        url: 'https://github.com/nodejs/node/issues/12345',
        body: 'long body '.repeat(100),
        labels: [{ name: 'bug' }, { name: 'i18n' }],
        createdAt: '2026-05-12T03:00:00Z',
        state: 'open',
        repository: { nameWithOwner: 'nodejs/node' },
      },
    ]);
    const r = await searchUpstreamIssues({ project: 'node', limit: 1 });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.count, 1);
      const m = r.matches[0]!;
      assert.equal(m.repo, 'nodejs/node');
      assert.equal(m.number, 12345);
      assert.equal(m.posted_at, '2026-05-12T03:00:00Z');
      assert.deepEqual(m.labels, ['bug', 'i18n']);
      assert.equal(m.has_pr, false);
      // body should be truncated to <= 500 chars
      assert.ok(m.body_snippet.length <= 500);
    }
  });

  it('strict policy drops cross-repo matches whose repository is in exclude_repos', async () => {
    // Search runs against `example-org/main-repo` but a result is from
    // `example-org/skip-me` (e.g. the user passed an `org:` query
    // qualifier). Caller-supplied exclude_repos must drop it.
    stubGh([
      {
        number: 1,
        title: 'a',
        url: 'https://github.com/example-org/main-repo/issues/1',
        body: '',
        repository: { nameWithOwner: 'example-org/main-repo' },
      },
      {
        number: 2,
        title: 'b',
        url: 'https://github.com/example-org/skip-me/issues/2',
        body: '',
        repository: { nameWithOwner: 'example-org/skip-me' },
      },
    ]);
    const r = await searchUpstreamIssues({
      repo: 'example-org/main-repo',
      exclude_repos: ['example-org/skip-me'],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.count, 1);
      assert.equal(r.matches[0]!.number, 1);
      assert.ok(r.notes.some((n) => /excluded 1 match/.test(n)));
    }
  });

  it('strict policy with empty exclude_repos returns matches unchanged', async () => {
    stubGh([
      {
        number: 1,
        title: 'a',
        url: '',
        body: '',
        repository: { nameWithOwner: 'example-org/main-repo' },
      },
    ]);
    const r = await searchUpstreamIssues({
      repo: 'example-org/main-repo',
      // exclude_repos omitted — Vivarium ships no defaults
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.count, 1);
      // The exclude_repos note must NOT appear when no exclusions
      // were supplied — Vivarium has no built-in list to mention.
      assert.ok(
        !r.notes.some((n) => /exclude_repos/.test(n)),
        'no exclude_repos note when none supplied',
      );
    }
  });

  it('returns ok:false on gh non-zero exit', async () => {
    stubGh([], { status: 1, stdout: '', stderr: 'auth failed' });
    const r = await searchUpstreamIssues({ repo: 'nodejs/node' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /gh exit 1/);
      assert.match(r.error, /auth failed/);
    }
  });

  it('returns ok:false on malformed gh JSON output', async () => {
    stubGh([], { stdout: 'not-json' });
    const r = await searchUpstreamIssues({ repo: 'nodejs/node' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /parse gh JSON/);
  });

  it('clamps limit to [1, 50]', async () => {
    const { capturedArgs } = stubGh([]);
    await searchUpstreamIssues({ repo: 'nodejs/node', limit: 9999 });
    const limitIdx = capturedArgs[0]!.indexOf('--limit');
    assert.equal(capturedArgs[0]![limitIdx + 1], '50');
  });

  it('forwards --label flags for each provided label', async () => {
    const { capturedArgs } = stubGh([]);
    await searchUpstreamIssues({
      repo: 'nodejs/node',
      labels: ['bug', 'good first issue'],
    });
    const labelCount = capturedArgs[0]!.filter((a) => a === '--label').length;
    assert.equal(labelCount, 2);
  });
});

describe('create_fork_pr', () => {
  const verifiedState = {
    upstream_issue: 'https://github.com/pandas-dev/pandas/issues/56679',
    fork: {
      owner: 'JamBalaya56562',
      repo: 'pandas',
      branch: 'fix-issue-56679',
    },
    verdicts: {
      unfixed: {
        verdict: 'reproduced' as const,
        captured_at: '2026-05-17T00:00:00Z',
        source: 'layer1-headless' as const,
      },
      fixed: {
        verdict: 'unreproduced' as const,
        captured_at: '2026-05-17T00:10:00Z',
        source: 'layer1-headless' as const,
      },
    },
  };

  it('returns ok:false on missing slug', async () => {
    const r = await createForkPr({
      slug: '',
      current_state: verifiedState,
      pr_title: 'fix: x',
    });
    assert.equal(r.ok, false);
  });

  it('returns ok:false on missing pr_title', async () => {
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: verifiedState,
      pr_title: '',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /pr_title is required/);
  });

  it('returns ok:false on unknown slug', async () => {
    const r = await createForkPr({
      slug: 'does-not-exist',
      current_state: verifiedState,
      pr_title: 'fix: x',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not found/);
  });

  it('returns ok:false when verdicts.unfixed is not "reproduced"', async () => {
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: {
        ...verifiedState,
        verdicts: {
          unfixed: {
            verdict: 'unreproduced',
            captured_at: '2026-05-17T00:00:00Z',
            source: 'layer1-headless',
          },
          fixed: verifiedState.verdicts.fixed,
        },
      },
      pr_title: 'fix: x',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not verified/);
  });

  it('returns ok:false when verdicts.fixed is missing', async () => {
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: {
        ...verifiedState,
        verdicts: { unfixed: verifiedState.verdicts.unfixed },
      },
      pr_title: 'fix: x',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not verified/);
  });

  it('returns ok:false when upstream_issue is malformed', async () => {
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: { ...verifiedState, upstream_issue: 'not a url' },
      pr_title: 'fix: x',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /cannot derive upstream/);
  });

  it('returns ok:false when fork is missing required fields', async () => {
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: {
        ...verifiedState,
        fork: { owner: 'JamBalaya56562', repo: 'pandas', branch: '' },
      },
      pr_title: 'fix: x',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /fork must have/);
  });

  it('dry_run=true (default) returns command without calling gh', async () => {
    let ghCalled = false;
    _setCreateForkPrGhRunnerForTesting(() => {
      ghCalled = true;
      return { status: 0, stdout: '', stderr: '' };
    });

    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: verifiedState,
      pr_title: 'fix: address pandas#56679',
      pr_body: 'See round-trip verification.',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.dry_run, true);
      assert.equal(r.upstream_repo, 'pandas-dev/pandas');
      assert.equal(r.head, 'JamBalaya56562:fix-issue-56679');
      assert.equal(r.draft, true);
      assert.deepEqual(r.labels, ['ai: generated']);
      assert.match(r.command, /gh pr create --repo pandas-dev\/pandas/);
      assert.match(r.command, /--head JamBalaya56562:fix-issue-56679/);
      assert.match(r.command, /--draft/);
      assert.match(r.command, /--label 'ai: generated'/);
      assert.equal(r.pr_url, undefined);
    }
    assert.equal(ghCalled, false, 'gh must NOT be called in dry_run mode');
  });

  it('dry_run=false → ok:false when gh auth check fails', async () => {
    _setCreateForkPrGhRunnerForTesting((args) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return { status: 1, stdout: '', stderr: 'not logged in' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: verifiedState,
      pr_title: 'fix: x',
      dry_run: false,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /gh auth/);
  });

  it('dry_run=false → ok:false when fork repo is not accessible', async () => {
    _setCreateForkPrGhRunnerForTesting((args) => {
      if (args[0] === 'auth') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'repo' && args[1] === 'view') {
        return { status: 1, stdout: '', stderr: 'not found' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: verifiedState,
      pr_title: 'fix: x',
      dry_run: false,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /fork .* not found/);
  });

  it('dry_run=false → ok:false when fork branch does not exist on the fork', async () => {
    _setCreateForkPrGhRunnerForTesting((args) => {
      if (args[0] === 'auth') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'repo' && args[1] === 'view') {
        return { status: 0, stdout: '{"name":"pandas"}', stderr: '' };
      }
      if (args[0] === 'api' && args[1]!.includes('branches')) {
        return { status: 1, stdout: '', stderr: 'branch not found' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: verifiedState,
      pr_title: 'fix: x',
      dry_run: false,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /branch .* not found/);
  });

  it('dry_run=false happy path → opens draft PR with mandatory label, returns PR URL', async () => {
    const calls: string[][] = [];
    _setCreateForkPrGhRunnerForTesting((args) => {
      calls.push(args);
      if (args[0] === 'auth') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'repo' && args[1] === 'view') {
        return { status: 0, stdout: '{"name":"pandas"}', stderr: '' };
      }
      if (args[0] === 'api') {
        return { status: 0, stdout: '{}', stderr: '' };
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        return {
          status: 0,
          stdout: 'https://github.com/pandas-dev/pandas/pull/12345\n',
          stderr: '',
        };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const r = await createForkPr({
      slug: 'pandas-56679',
      current_state: verifiedState,
      pr_title: 'fix: address pandas#56679',
      pr_body: 'See round-trip verification.',
      dry_run: false,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.dry_run, false);
      assert.equal(r.pr_url, 'https://github.com/pandas-dev/pandas/pull/12345');
      assert.equal(r.draft, true);
      assert.deepEqual(r.labels, ['ai: generated']);
    }

    // gh pr create call must include --draft and --label 'ai: generated'
    const createCall = calls.find((a) => a[0] === 'pr' && a[1] === 'create');
    assert.ok(createCall, 'expected a gh pr create call');
    assert.ok(createCall!.includes('--draft'));
    const labelIdx = createCall!.indexOf('--label');
    assert.equal(createCall![labelIdx + 1], 'ai: generated');
    const repoIdx = createCall!.indexOf('--repo');
    assert.equal(createCall![repoIdx + 1], 'pandas-dev/pandas');
    const headIdx = createCall!.indexOf('--head');
    assert.equal(createCall![headIdx + 1], 'JamBalaya56562:fix-issue-56679');
  });
});
