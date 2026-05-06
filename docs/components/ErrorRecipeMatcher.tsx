import { useMemo, useState } from 'react';
import './error-recipe-matcher.css';
import recipesIndex from '../public/api/recipes.json';

/* ============================================================================
 * Phase 6 S.2 → Phase 7 A5 — error → recipe matcher (mechanical, no LLM).
 *
 * Mechanical token-overlap scoring per ADR-0025:
 *   symptom segment match → +5
 *   tag segment match     → +3
 *   project / slug match  → +2
 * Recipes with score 0 are hidden. Ties broken by (layer asc, slug asc).
 *
 * Phase 7 A5 (ADR-0028) extends v1 with three accuracy improvements that
 * never change the weights above:
 *   1. Adjacent-pair token expansion — "data type" also tries `datatype`.
 *   2. Synonym groups — variants of the same concept (e.g. dtype⇄datatype).
 *   3. Bounded fuzzy match — Levenshtein distance ≤ 1 for tokens of
 *      length ≥ 6 (typo tolerance).
 *   4. Multi-language stopwords — German, Spanish, French, Chinese,
 *      Korean noise tokens drop alongside the English+Japanese set.
 *
 * **CRITICAL: keep in sync with `packages/mcp-server/src/tools/match_error.ts`.**
 * The MCP X.2 server-side mirror is bit-identical with this file by ADR
 * design. Diverging the scoring would surface as agent-vs-UI disagreement
 * on identical input.
 * ========================================================================== */

interface RecipeEntry {
  slug: string;
  layer: 1 | 2 | 3;
  project: string;
  issue: number;
  title: string;
  page_url: string;
  source_url: string;
  language: string;
  symptom?: string;
  severity?: string;
  tags: string[];
}

interface RecipesIndex {
  index: 'v1';
  contract: 'v1';
  recipes: RecipeEntry[];
}

const INDEX = recipesIndex as RecipesIndex;

const MAX_INPUT_BYTES = 16 * 1024;

/* Multi-language stopword set (Phase 7 A5). The goal is dropping the
 * frequent noise tokens that would never sit in a recipe overlay
 * anyway, not full lexical coverage of any one language. */
const STOPWORDS = new Set([
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
  // Chinese (Simplified + Traditional)
  '错误', '异常', '失败', '堆栈', '錯誤', '異常', '失敗', '堆疊',
  // Korean
  '오류', '예외', '실패', '스택',
]);

/* Synonym groups (Phase 7 A5). Within a group, any token in the
 * user's input expands the input set to include all members.
 * Conservative on purpose — false-positive pressure rises with table
 * size. Add entries only when the mapping is unambiguous. */
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

/* Bounded fuzzy match (Phase 7 A5). Only tokens of length ≥
 * FUZZY_MIN_LEN are eligible; only Levenshtein distance ≤ 1 is
 * accepted. Same scoring weight as exact, but matched tokens
 * record `via: 'fuzzy'` for client-side rendering. */
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
  /** Direct tokens after splitting + stopword filter + adjacent-pair join. */
  direct: ReadonlySet<string>;
  /** Synonym-expanded tokens: catalogue-side variant → original input token. */
  synonyms: ReadonlyMap<string, string>;
  /** Direct tokens of length ≥ FUZZY_MIN_LEN, eligible for fuzzy matching. */
  fuzzyCandidates: ReadonlyArray<string>;
  /** Ordered display list (de-duplicated, no synonym/pair additions). */
  displayOrder: ReadonlyArray<string>;
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

  // Stage 3: synonym expansion.
  const synonyms = new Map<string, string>();
  for (const t of direct) {
    const partners = SYNONYM_MAP.get(t);
    if (!partners) continue;
    for (const p of partners) {
      if (direct.has(p) || synonyms.has(p)) continue;
      synonyms.set(p, t);
    }
  }

  // Stage 4: fuzzy candidate set.
  const fuzzyCandidates: string[] = [];
  for (const t of direct) {
    if (t.length >= FUZZY_MIN_LEN) fuzzyCandidates.push(t);
  }

  return { direct, synonyms, fuzzyCandidates, displayOrder: ordered };
}

function kebabSegments(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

interface MatchedToken {
  source: 'symptom' | 'tags' | 'project' | 'slug';
  token: string;
  via?: 'synonym' | 'fuzzy';
  input?: string;
}

interface Score {
  recipe: RecipeEntry;
  score: number;
  matched: MatchedToken[];
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

function scoreRecipe(recipe: RecipeEntry, tokens: TokenSet): Score {
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
  for (const tag of recipe.tags) {
    for (const seg of kebabSegments(tag)) apply('tags', 3, seg);
  }
  for (const seg of kebabSegments(recipe.project)) apply('project', 2, seg);
  for (const seg of kebabSegments(recipe.slug)) apply('slug', 2, seg);

  return { recipe, score, matched };
}

/* --------------------------------- i18n ---------------------------------- */

type Lang = 'en' | 'ja';

interface Strings {
  eyebrow: string;
  inputLabel: string;
  inputPlaceholder: string;
  clear: string;
  tokenisedAs: string;
  resultsHeading: string;
  resultsCount: (n: number, total: number) => string;
  emptyHeading: string;
  emptyBody: (galleryHref: string) => React.ReactNode;
  noInputBody: string;
  scoreLabel: string;
  matchedTokensLabel: string;
  open: string;
  galleryLink: string;
  layerName: (layer: 1 | 2 | 3) => string;
}

const STRINGS: Record<Lang, Strings> = {
  en: {
    eyebrow: '// MATCH · ERROR → RECIPE',
    inputLabel: 'Paste an error message or stack trace',
    inputPlaceholder:
      'Traceback (most recent call last):\n  File "foo.py", line 42, in bar\n    df = pd.DataFrame()\nValueError: dtype mismatch on empty Series',
    clear: 'clear',
    tokenisedAs: 'tokenised as:',
    resultsHeading: '// RANKED CANDIDATES',
    resultsCount: (n, total) =>
      `${n} candidate${n === 1 ? '' : 's'} (of ${total} recipes)`,
    emptyHeading: 'No recipes match these tokens.',
    emptyBody: (galleryHref) => (
      <>
        Try a different fragment of the error, or browse the{' '}
        <a href={galleryHref}>gallery</a>.
      </>
    ),
    noInputBody:
      'Paste an error or stack trace above — matches update as you type.',
    scoreLabel: 'score',
    matchedTokensLabel: 'matched',
    open: 'Open ↗',
    galleryLink: './',
    layerName: (layer) =>
      layer === 1
        ? 'L1 · WASM'
        : layer === 2
          ? 'L2 · Docker'
          : 'L3 · Record-replay',
  },
  ja: {
    eyebrow: '// マッチ · エラー → レシピ',
    inputLabel: 'エラーメッセージまたはスタックトレースを貼り付ける',
    inputPlaceholder:
      'Traceback (most recent call last):\n  File "foo.py", line 42, in bar\n    df = pd.DataFrame()\nValueError: dtype mismatch on empty Series',
    clear: 'クリア',
    tokenisedAs: 'トークン化:',
    resultsHeading: '// ランク付き候補',
    resultsCount: (n, total) =>
      `${n} 件 (全 ${total} レシピ中)`,
    emptyHeading: 'このトークンに該当するレシピがない。',
    emptyBody: (galleryHref) => (
      <>
        エラーの別の部分を試すか、
        <a href={galleryHref}>ギャラリー</a>
        を参照する。
      </>
    ),
    noInputBody:
      '上のエリアにエラーまたはスタックを貼り付けると、入力に応じて候補が即座に絞り込まれる。',
    scoreLabel: 'スコア',
    matchedTokensLabel: '一致したトークン',
    open: '開く ↗',
    galleryLink: './',
    layerName: (layer) =>
      layer === 1
        ? 'L1 · WASM'
        : layer === 2
          ? 'L2 · Docker'
          : 'L3 · 記録再生',
  },
};

/* ------------------------------ Components ------------------------------ */

function MatchCard({ lang, score }: { lang: Lang; score: Score }) {
  const s = STRINGS[lang];
  const r = score.recipe;
  const layerAccent =
    r.layer === 1 ? 'teal' : r.layer === 2 ? 'violet' : 'coral';
  // Dedupe matched tokens for display while preserving first-seen order.
  const seen = new Set<string>();
  const displayTokens: MatchedToken[] = [];
  for (const m of score.matched) {
    const key = `${m.source}:${m.token}:${m.via ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    displayTokens.push(m);
  }
  return (
    <article className="v-rg__card v-erm__card">
      <header className="v-rg__card-head">
        <span
          className={`v-rg__layer-pill v-rg__layer-pill--${layerAccent}`}
        >
          {s.layerName(r.layer)}
        </span>
        <span className="v-erm__score">
          <span className="v-erm__score-key">{s.scoreLabel}</span>{' '}
          <code>{score.score}</code>
        </span>
      </header>
      <h3 className="v-rg__title">
        {r.project}
        {r.issue > 0 ? <span>#{r.issue}</span> : null}
      </h3>
      <p className="v-rg__lede">{r.title}</p>
      <div className="v-erm__matched">
        <span className="v-erm__matched-key">{s.matchedTokensLabel}:</span>
        {displayTokens.map((m, i) => {
          const viaMark = m.via === 'fuzzy' ? '~' : m.via === 'synonym' ? '≡' : null;
          const title = m.via && m.input
            ? `${m.via} match (input: ${m.input})`
            : undefined;
          return (
            <span
              key={i}
              className={`v-erm__token v-erm__token--${m.source}${m.via ? ' v-erm__token--' + m.via : ''}`}
              title={title}
            >
              <span className="v-erm__token-source">{m.source[0]}</span>
              {m.token}
              {viaMark ? <span className="v-erm__token-via">{viaMark}</span> : null}
            </span>
          );
        })}
      </div>
      <div className="v-rg__actions">
        <a
          className="v-rg__btn v-rg__btn--primary"
          href={r.page_url}
          target="_blank"
          rel="noreferrer"
        >
          {s.open}
        </a>
      </div>
    </article>
  );
}

/* -------------------------------- Main -------------------------------- */

export function ErrorRecipeMatcher({ lang }: { lang: Lang }) {
  const s = STRINGS[lang];
  const [input, setInput] = useState('');

  // Live filter — every keystroke re-scores against `input` directly.
  // No debounce: 11 recipes × O(token) is sub-millisecond and the matcher
  // has no other settings (layer/severity toggles etc.) so there is no
  // submit semantic to wait on. Clear button is the only escape hatch.
  const tokens = useMemo(() => tokenise(input), [input]);

  const ranked = useMemo<Score[]>(() => {
    if (tokens.displayOrder.length === 0) return [];
    const scored = INDEX.recipes
      .map((r) => scoreRecipe(r, tokens))
      .filter((s) => s.score > 0);
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.recipe.layer !== b.recipe.layer) return a.recipe.layer - b.recipe.layer;
      return a.recipe.slug.localeCompare(b.recipe.slug);
    });
    return scored;
  }, [tokens]);

  const clear = () => setInput('');

  const hasInput = input.trim().length > 0;
  const hasResults = ranked.length > 0;

  return (
    <section className="v-erm">
      <p className="v-erm__eyebrow">{s.eyebrow}</p>
      <label className="v-erm__field">
        <span className="v-erm__field-label">{s.inputLabel}</span>
        <textarea
          className="v-erm__field-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={s.inputPlaceholder}
          rows={8}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
      <div className="v-erm__actions">
        <button
          type="button"
          className="v-erm__btn v-erm__btn--ghost"
          onClick={clear}
          disabled={!input}
        >
          {s.clear}
        </button>
      </div>

      {hasInput && tokens.displayOrder.length > 0 ? (
        <div className="v-erm__tokens">
          <span className="v-erm__tokens-label">{s.tokenisedAs}</span>
          {tokens.displayOrder.map((t) => (
            <span key={t} className="v-erm__token v-erm__token--input">
              {t}
            </span>
          ))}
        </div>
      ) : null}

      {hasInput ? (
        hasResults ? (
          <div className="v-erm__results">
            <header className="v-erm__results-header">
              <span className="v-erm__results-eyebrow">{s.resultsHeading}</span>
              <span className="v-erm__results-count">
                {s.resultsCount(ranked.length, INDEX.recipes.length)}
              </span>
            </header>
            <div className="v-rg__cards">
              {ranked.map((score) => (
                <MatchCard key={score.recipe.slug} lang={lang} score={score} />
              ))}
            </div>
          </div>
        ) : (
          <div className="v-erm__empty">
            <p className="v-erm__empty-heading">{s.emptyHeading}</p>
            <p className="v-erm__empty-body">{s.emptyBody(s.galleryLink)}</p>
          </div>
        )
      ) : (
        <p className="v-erm__hint">{s.noInputBody}</p>
      )}
    </section>
  );
}

export default ErrorRecipeMatcher;
