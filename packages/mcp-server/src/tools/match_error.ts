// Phase 6 X.2 — match_error tool.
//
// Server-side mirror of the docs-site error → recipe matcher (Phase 6 S.2,
// ADR-0025). The scoring rule is bit-identical:
//   symptom segment match → +5
//   tag segment match     → +3
//   project / slug match  → +2
// Recipes with score 0 are dropped. Ties broken by (layer asc, slug asc).
//
// ADR-0025 §Neutral named this lift explicitly:
//   "A future X.2 ... could expose this matcher to agents. The scoring
//    rule is identical, so an X.2 implementation would lift the function
//    from ErrorRecipeMatcher.tsx into the MCP server."
//
// The lift is mechanical — no LLM, no fuzzy match, no synonym table.
// AGENTS.md §3.3's mechanical-over-judgement rule carries through.

import { getCatalogue } from '../catalogue.js';
import type { RecipeEntry } from '../types.js';

export interface MatchErrorArgs {
  text: string;
  limit?: number;
}

interface MatchedToken {
  source: 'symptom' | 'tags' | 'project' | 'slug';
  token: string;
}

interface ScoredRecipe {
  recipe: RecipeEntry;
  score: number;
  matched: MatchedToken[];
}

export interface MatchErrorResult {
  ok: true;
  query_token_count: number;
  total_recipes: number;
  matches: ScoredRecipe[];
}

const MAX_INPUT_BYTES = 16 * 1024;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have',
  'has', 'are', 'was', 'were', 'will', 'not', 'but', 'all',
  'error', 'errors', 'exception', 'failed', 'failure', 'trace',
  'traceback', 'stack', 'line', 'file', 'most', 'recent', 'call',
  'です', 'ます', 'した', 'する', 'これ', 'それ', 'その', 'この',
  'エラー', '例外', '失敗', 'スタック',
]);

function tokenise(input: string): string[] {
  let trimmed = input;
  if (trimmed.length > MAX_INPUT_BYTES) {
    trimmed = trimmed.slice(trimmed.length - MAX_INPUT_BYTES);
  }
  const lower = trimmed.toLowerCase();
  const raw = lower.split(/[^a-z0-9_]+/);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }
  return tokens;
}

function kebabSegments(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function scoreRecipe(
  recipe: RecipeEntry,
  tokens: ReadonlySet<string>,
): ScoredRecipe {
  const matched: MatchedToken[] = [];
  let score = 0;

  if (recipe.symptom) {
    for (const seg of kebabSegments(recipe.symptom)) {
      if (tokens.has(seg)) {
        score += 5;
        matched.push({ source: 'symptom', token: seg });
      }
    }
  }
  for (const tag of recipe.tags ?? []) {
    for (const seg of kebabSegments(tag)) {
      if (tokens.has(seg)) {
        score += 3;
        matched.push({ source: 'tags', token: seg });
      }
    }
  }
  for (const seg of kebabSegments(recipe.project)) {
    if (tokens.has(seg)) {
      score += 2;
      matched.push({ source: 'project', token: seg });
    }
  }
  for (const seg of kebabSegments(recipe.slug)) {
    if (tokens.has(seg)) {
      score += 2;
      matched.push({ source: 'slug', token: seg });
    }
  }

  return { recipe, score, matched };
}

export async function matchError(
  args: MatchErrorArgs,
): Promise<MatchErrorResult | { ok: false; error: string }> {
  const text = (args.text ?? '').trim();
  if (!text) {
    return { ok: false, error: 'missing required argument: text' };
  }
  const limit = Math.min(
    Math.max(1, args.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  const tokens = tokenise(text);
  const tokenSet = new Set(tokens);

  const { recipes } = await getCatalogue();
  const scored = recipes
    .map((r) => scoreRecipe(r, tokenSet))
    .filter((s) => s.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.recipe.layer !== b.recipe.layer)
      return a.recipe.layer - b.recipe.layer;
    return a.recipe.slug.localeCompare(b.recipe.slug);
  });

  return {
    ok: true,
    query_token_count: tokens.length,
    total_recipes: recipes.length,
    matches: scored.slice(0, limit),
  };
}

export const MATCH_ERROR_TOOL = {
  name: 'match_error',
  description:
    "Find Vivarium recipes that match a pasted error message or stack trace by mechanical token overlap (no LLM, no fuzzy match). The text is tokenised, lowercase-compared against each recipe's symptom (weight 5 per segment), tags (3), project (2), and slug (2). Recipes with score > 0 are returned in descending score order; ties broken by (layer asc, slug asc). Returns the recipe entry plus the matched tokens for each candidate so agents can show which fragments hit. Pair with `get_recipe` to drill into a specific result, or `list_recipes` for unfiltered browsing.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string' as const,
        description:
          'Error message, stack trace, or any free-text fragment to match against the catalogue. Tokenised on non-alphanumeric runs after lowercasing; tokens shorter than 3 chars and a fixed English+Japanese stopword list are dropped. Input longer than 16 KB is truncated from the front.',
      },
      limit: {
        type: 'integer' as const,
        minimum: 1,
        maximum: 50,
        default: 10,
        description:
          'Maximum number of matches to return. Defaults to 10; capped at 50.',
      },
    },
    required: ['text'],
  },
} as const;
