// Phase 6 X.2 → Phase 7 A5 — match_error tool, v2.
//
// Server-side mirror of the docs-site error → recipe matcher
// (Phase 6 S.2, ADR-0025). The scoring weights are bit-identical
// with the docs-site `ErrorRecipeMatcher.tsx`:
//   symptom segment match → +5
//   tag segment match     → +3
//   project / slug match  → +2
// Recipes with score 0 are dropped. Ties broken by (layer asc, slug asc).
//
// Phase 7 A5 (ADR-0028) extends v1 with three accuracy improvements,
// none of which change the weights above:
//   1. Adjacent-pair token expansion — "data type" also tries `datatype`,
//      so multi-word user input can hit single-word catalogue terms.
//   2. Synonym groups — variants of the same concept (e.g. `dtype` ⇄
//      `datatype`) all expand to the whole group.
//   3. Bounded fuzzy match — tokens of length ≥ 6 within Levenshtein
//      distance 1 score the same as exact, so "missmatch" still hits
//      `mismatch`.
//   4. Multi-language stopwords — German, Spanish, French, Chinese,
//      Korean noise tokens drop alongside the existing English+Japanese.
//
// **CRITICAL: keep in sync with `docs/components/ErrorRecipeMatcher.tsx`.**
// ADR-0025 §Neutral made the docs surface the canonical implementation;
// X.2 lifted it server-side bit-identical, and A5 keeps both copies
// updated atomically. Diverging the scoring between MCP and the docs
// matcher would surface as agent-vs-UI disagreement on identical input.
//
// The matcher remains mechanical — no LLM, no semantic embeddings.
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
  /**
   * How the token was matched. Omitted (undefined) for direct exact
   * matches (the v1 case). `synonym` indicates the catalogue token
   * was reached via a synonym-group expansion of an input token.
   * `fuzzy` indicates a Levenshtein-distance-1 match (typo-tolerant).
   * v1 clients ignore this field; v2 clients can render the
   * provenance.
   */
  via?: 'synonym' | 'fuzzy';
  /**
   * Original input token that triggered a non-exact match (set when
   * `via` is `synonym` or `fuzzy`). Lets agents render "you wrote X,
   * we matched Y."
   */
  input?: string;
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

// Multi-language stopword set (Phase 7 A5). The goal isn't full
// lexical coverage of any single language — it's dropping the
// frequent noise tokens that would never sit in a recipe overlay.
// Anything that sneaks through scores 0 against the catalogue
// anyway; the worst case is wasted comparison cycles, not wrong
// matches.
const STOPWORDS: ReadonlySet<string> = new Set([
  // English
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have',
  'has', 'are', 'was', 'were', 'will', 'not', 'but', 'all',
  'error', 'errors', 'exception', 'failed', 'failure', 'trace',
  'traceback', 'stack', 'line', 'file', 'most', 'recent', 'call',
  // Japanese
  'です', 'ます', 'した', 'する', 'これ', 'それ', 'その', 'この',
  'エラー', '例外', '失敗', 'スタック',
  // German
  'der', 'die', 'das', 'und', 'mit', 'von', 'für', 'fehler',
  'ausnahme', 'aufgetreten',
  // Spanish
  'que', 'por', 'una', 'los', 'las', 'del', 'con',
  'excepción', 'fallo',
  // French
  'pour', 'avec', 'sur', 'dans', 'erreur',
  'échec',
  // Chinese (Simplified + Traditional, common particles + error words)
  '错误', '异常', '失败', '堆栈', '錯誤', '異常', '失敗', '堆疊',
  // Korean (common particles + error words)
  '오류', '예외', '실패', '스택',
]);

// Synonym groups (Phase 7 A5). Within a group, any token in the
// user's input expands the input set to include all members.
// Variants are stored hyphen-stripped (lowercase, alphanumeric)
// to match the kebab-segmented catalogue tokens.
//
// Conservative on purpose — false-positive pressure rises with
// table size. Add a group only when there's an unambiguous mapping
// between a user-input shape and a catalogue overlay token.
const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ['dtype', 'datatype'],
  ['nullptr', 'nullpointer', 'nilptr', 'nullpointerexception'],
  ['segfault', 'sigsegv', 'segmentation'],
  ['flock', 'filelock'],
  ['deadlock', 'deadblock'],
  ['datarace', 'racecondition'],
  ['exitcode', 'exitstatus', 'returncode'],
  ['oom', 'outofmemory'],
  ['encoding', 'utf'],
  ['mismatch', 'mismatched'],
];

const SYNONYM_MAP: ReadonlyMap<string, ReadonlyArray<string>> = (() => {
  const m = new Map<string, ReadonlyArray<string>>();
  for (const group of SYNONYM_GROUPS) {
    for (const member of group) {
      m.set(member, group.filter((g) => g !== member));
    }
  }
  return m;
})();

// Phase 7 A5: bounded fuzzy match. Only fires for tokens of length
// ≥ FUZZY_MIN_LEN; only Levenshtein distance ≤ 1 is accepted (single
// insert / delete / substitute). Same weight as exact, but the
// MatchedToken records `via: 'fuzzy'` for client-side rendering.
const FUZZY_MIN_LEN = 6;

function withinDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 1) return false;
  if (lenA === lenB) {
    let diffs = 0;
    for (let i = 0; i < lenA; i++) {
      if (a[i] !== b[i]) {
        diffs++;
        if (diffs > 1) return false;
      }
    }
    return diffs === 1;
  }
  const shorter = lenA < lenB ? a : b;
  const longer = lenA < lenB ? b : a;
  let i = 0;
  let j = 0;
  let diffs = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] !== longer[j]) {
      diffs++;
      if (diffs > 1) return false;
      j++;
    } else {
      i++;
      j++;
    }
  }
  return true;
}

interface TokenSet {
  /** Direct tokens (no synonym/fuzzy provenance). */
  direct: ReadonlySet<string>;
  /** Synonym-expanded tokens with their original input tokens. */
  synonyms: ReadonlyMap<string, string>;
  /** Long enough for fuzzy matching (length ≥ FUZZY_MIN_LEN). */
  fuzzyCandidates: ReadonlyArray<string>;
}

function tokenise(input: string): TokenSet {
  let trimmed = input;
  if (trimmed.length > MAX_INPUT_BYTES) {
    trimmed = trimmed.slice(trimmed.length - MAX_INPUT_BYTES);
  }
  const lower = trimmed.toLowerCase();
  const raw = lower.split(/[^a-z0-9_]+/);

  // Stage 1: filter raw tokens (length ≥ 3, not stopword, dedup).
  const ordered: string[] = [];
  const seenRaw = new Set<string>();
  for (const t of raw) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    if (seenRaw.has(t)) continue;
    seenRaw.add(t);
    ordered.push(t);
  }

  // Stage 2: adjacent-pair expansion. Lets multi-word user input
  // (e.g. "data type") match single-word catalogue terms (`dtype`)
  // via the synonym table.
  const direct = new Set<string>(ordered);
  for (let i = 0; i < ordered.length - 1; i++) {
    direct.add(ordered[i]! + ordered[i + 1]!);
  }

  // Stage 3: synonym expansion. For each direct token, if it has a
  // synonym group, add the other members and remember which input
  // token brought them in.
  const synonyms = new Map<string, string>();
  for (const t of direct) {
    const partners = SYNONYM_MAP.get(t);
    if (!partners) continue;
    for (const p of partners) {
      if (direct.has(p) || synonyms.has(p)) continue;
      synonyms.set(p, t);
    }
  }

  // Stage 4: fuzzy candidate set — direct tokens (not synonym
  // additions) of sufficient length.
  const fuzzyCandidates: string[] = [];
  for (const t of direct) {
    if (t.length >= FUZZY_MIN_LEN) fuzzyCandidates.push(t);
  }

  return { direct, synonyms, fuzzyCandidates };
}

function kebabSegments(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

interface SegmentMatch {
  matched: boolean;
  via?: 'synonym' | 'fuzzy';
  input?: string;
}

function matchSegment(seg: string, tokens: TokenSet): SegmentMatch {
  if (tokens.direct.has(seg)) return { matched: true };
  const synonymInput = tokens.synonyms.get(seg);
  if (synonymInput !== undefined) {
    return { matched: true, via: 'synonym', input: synonymInput };
  }
  if (seg.length >= FUZZY_MIN_LEN) {
    for (const candidate of tokens.fuzzyCandidates) {
      if (withinDistance1(seg, candidate)) {
        return { matched: true, via: 'fuzzy', input: candidate };
      }
    }
  }
  return { matched: false };
}

function scoreRecipe(
  recipe: RecipeEntry,
  tokens: TokenSet,
): ScoredRecipe {
  const matched: MatchedToken[] = [];
  let score = 0;

  const apply = (
    source: MatchedToken['source'],
    weight: number,
    seg: string,
  ) => {
    const m = matchSegment(seg, tokens);
    if (!m.matched) return;
    score += weight;
    const entry: MatchedToken = { source, token: seg };
    if (m.via) entry.via = m.via;
    if (m.input !== undefined) entry.input = m.input;
    matched.push(entry);
  };

  if (recipe.symptom) {
    for (const seg of kebabSegments(recipe.symptom)) apply('symptom', 5, seg);
  }
  for (const tag of recipe.tags ?? []) {
    for (const seg of kebabSegments(tag)) apply('tags', 3, seg);
  }
  for (const seg of kebabSegments(recipe.project)) apply('project', 2, seg);
  for (const seg of kebabSegments(recipe.slug)) apply('slug', 2, seg);

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

  const { recipes } = await getCatalogue();
  const scored = recipes
    .map((r) => scoreRecipe(r, tokens))
    .filter((s) => s.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.recipe.layer !== b.recipe.layer)
      return a.recipe.layer - b.recipe.layer;
    return a.recipe.slug.localeCompare(b.recipe.slug);
  });

  return {
    ok: true,
    query_token_count: tokens.direct.size,
    total_recipes: recipes.length,
    matches: scored.slice(0, limit),
  };
}

export const MATCH_ERROR_TOOL = {
  name: 'match_error',
  description:
    "Find Vivarium recipes that match a pasted error message or stack trace by mechanical token overlap (no LLM). The text is tokenised, lowercase-compared against each recipe's symptom (weight 5 per segment), tags (3), project (2), and slug (2). v2 (Phase 7 A5) adds adjacent-pair tokens (so 'data type' can hit `dtype`), a small synonym table (e.g. dtype⇄datatype, segfault⇄sigsegv), and bounded Levenshtein-1 fuzzy matching for tokens of length ≥ 6. Stopword set covers English, Japanese, German, Spanish, French, Chinese, and Korean noise tokens. Recipes with score > 0 are returned in descending score order; ties broken by (layer asc, slug asc). Each matched token reports its `via` (`synonym` or `fuzzy` when non-exact) and the original `input` that triggered it, so agents can render the provenance. Pair with `get_recipe` to drill into a specific result, or `list_recipes` for unfiltered browsing.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string' as const,
        description:
          'Error message, stack trace, or any free-text fragment to match against the catalogue. Tokenised on non-alphanumeric runs after lowercasing; tokens shorter than 3 chars and a multi-language stopword list are dropped. Input longer than 16 KB is truncated from the front.',
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
