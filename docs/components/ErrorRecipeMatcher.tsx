import { useMemo, useState } from 'react';
import './error-recipe-matcher.css';
import recipesIndex from '../public/api/recipes.json';

/* ============================================================================
 * Phase 6 S.2 — error → recipe matcher (mechanical, no LLM).
 *
 * Mechanical token-overlap scoring per ADR-0025:
 *   symptom segment match → +5
 *   tag segment match     → +3
 *   project / slug match  → +2
 * Recipes with score 0 are hidden. Ties broken by (layer asc, slug asc).
 *
 * No LLM, no fuzzy match, no synonym table. Visitors pasting an error
 * with no overlap to the overlay see the empty-state pointing at the
 * gallery (S.1).
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

/* English + Japanese stopwords. Kept short; the goal is to drop noise
 * tokens that would never sit in a recipe's overlay anyway, not to
 * provide full lexical coverage. */
const STOPWORDS = new Set([
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

interface Score {
  recipe: RecipeEntry;
  score: number;
  matched: { source: 'symptom' | 'tags' | 'project' | 'slug'; token: string }[];
}

function scoreRecipe(recipe: RecipeEntry, tokens: Set<string>): Score {
  const matched: Score['matched'] = [];
  let score = 0;

  if (recipe.symptom) {
    for (const seg of kebabSegments(recipe.symptom)) {
      if (tokens.has(seg)) {
        score += 5;
        matched.push({ source: 'symptom', token: seg });
      }
    }
  }
  for (const tag of recipe.tags) {
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
  const tokens: { token: string; source: string }[] = [];
  for (const m of score.matched) {
    const key = `${m.source}:${m.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(m);
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
        {tokens.map((m, i) => (
          <span key={i} className={`v-erm__token v-erm__token--${m.source}`}>
            <span className="v-erm__token-source">{m.source[0]}</span>
            {m.token}
          </span>
        ))}
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
  const tokenSet = useMemo(() => new Set(tokens), [tokens]);

  const ranked = useMemo<Score[]>(() => {
    if (tokens.length === 0) return [];
    const scored = INDEX.recipes
      .map((r) => scoreRecipe(r, tokenSet))
      .filter((s) => s.score > 0);
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.recipe.layer !== b.recipe.layer) return a.recipe.layer - b.recipe.layer;
      return a.recipe.slug.localeCompare(b.recipe.slug);
    });
    return scored;
  }, [tokens, tokenSet]);

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

      {hasInput && tokens.length > 0 ? (
        <div className="v-erm__tokens">
          <span className="v-erm__tokens-label">{s.tokenisedAs}</span>
          {tokens.map((t) => (
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
