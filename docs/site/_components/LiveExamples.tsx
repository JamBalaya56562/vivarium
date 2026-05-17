// Data-driven recipe references for visitor-facing docs.
//
// Reads `docs/site/public/api/recipes.json` at build time (same import
// pattern as RecipeGallery) and resolves slug references against the
// current catalogue, so deleting a recipe under `src/layer*_*/` no
// longer requires a parallel docs sweep. See ADR-0035-equivalent
// rationale in PR #235 (generator → MDX-consumer pattern).
//
// The hero (`VivariumHero.tsx`) is the deliberate exception — its
// three slugs are paired with hand-written copy that can't be derived
// here, and are pinned with a header comment + checklist entry.

import recipesIndex from '../public/api/recipes.json';

interface RecipeEntry {
  slug: string;
  layer: 1 | 2 | 3;
  project: string;
  issue: number;
  title: string;
  page_url: string;
  source_url: string;
  verdict_url?: string;
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

type Lang = 'en' | 'ja';

// Mirror RecipeGallery's localizeRecipeUrl: when the docs are served
// from a non-production origin (rspress dev, a fork's Pages deploy),
// rewrite the recipe's baked-in absolute URL to the current origin so
// in-page links stay clickable.
function localizeRecipeUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  try {
    const u = new URL(url);
    return window.location.origin + u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

interface SelectFilters {
  layer: 1 | 2 | 3;
  language?: string;
  project?: string;
  kind?: 'numeric' | 'descriptive';
}

function selectRecipes(filters: SelectFilters): RecipeEntry[] {
  return INDEX.recipes
    .filter((r) => r.layer === filters.layer)
    .filter((r) => !filters.language || r.language === filters.language)
    .filter((r) => !filters.project || r.project === filters.project)
    .filter((r) => {
      if (filters.kind === 'numeric') return r.issue > 0;
      if (filters.kind === 'descriptive') return r.issue === 0;
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (b.issue !== a.issue) return b.issue - a.issue;
      return a.slug.localeCompare(b.slug);
    });
}

const SEPARATORS: Record<Lang, { and: string; comma: string }> = {
  en: { and: ' and ', comma: ', ' },
  ja: { and: 'や', comma: '、' },
};

const EMPTY_FALLBACK: Record<Lang, React.ReactNode> = {
  en: (
    <em>
      (no live example yet — see <a href="/vivarium/repro/">the gallery</a>)
    </em>
  ),
  ja: (
    <em>
      (該当する live サンプルなし —{' '}
      <a href="/vivarium/ja/repro/">ギャラリーを参照</a>)
    </em>
  ),
};

interface LiveExamplesProps {
  layer: 1 | 2 | 3;
  language?: string;
  project?: string;
  kind?: 'numeric' | 'descriptive';
  limit?: number;
  format?: 'list' | 'inline-prose';
  lang?: Lang;
  fallback?: React.ReactNode;
}

export function LiveExamples({
  layer,
  language,
  project,
  kind,
  limit,
  format = 'list',
  lang = 'en',
  fallback,
}: LiveExamplesProps) {
  const matches = selectRecipes({ layer, language, project, kind });
  const picked = typeof limit === 'number' ? matches.slice(0, limit) : matches;

  if (picked.length === 0) {
    const f = fallback ?? EMPTY_FALLBACK[lang];
    if (format === 'inline-prose') return <>{f}</>;
    return (
      <ul>
        <li>{f}</li>
      </ul>
    );
  }

  if (format === 'inline-prose') {
    const sep = SEPARATORS[lang];
    return (
      <>
        {picked.map((r, i) => (
          <span key={r.slug}>
            {i > 0 ? (i === picked.length - 1 ? sep.and : sep.comma) : null}
            <a href={localizeRecipeUrl(r.page_url)}>
              {r.project}#{r.issue}
            </a>
          </span>
        ))}
      </>
    );
  }

  return (
    <ul>
      {picked.map((r) => (
        <li key={r.slug}>
          <a href={localizeRecipeUrl(r.page_url)}>{r.title}</a>
        </li>
      ))}
    </ul>
  );
}

interface ExampleSlugProps {
  layer: 1 | 2 | 3;
  language?: string;
  project?: string;
  kind?: 'numeric' | 'descriptive';
  linked?: boolean;
  fallback?: string;
}

export function ExampleSlug({
  layer,
  language,
  project,
  kind,
  linked = false,
  fallback,
}: ExampleSlugProps) {
  const matches = selectRecipes({ layer, language, project, kind });
  const picked = matches[0];

  if (!picked) {
    const text = fallback ?? `<${language ?? 'project'}-<issue>>`;
    return <>{text}</>;
  }

  if (linked) {
    return <a href={localizeRecipeUrl(picked.page_url)}>{picked.slug}</a>;
  }
  return <>{picked.slug}</>;
}

export default LiveExamples;
