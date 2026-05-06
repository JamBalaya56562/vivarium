import { useMemo } from 'react';
import './project-page.css';
import projectsIndex from '../public/api/projects.json';
import recipesIndex from '../public/api/recipes.json';

/* ============================================================================
 * Project landing page.
 *
 * Mounted from each `docs/docs/{en,ja}/repro/<project>/index.mdx` to back the
 * `/repro/<project>/` URL — the natural truncation target when a visitor
 * trims `/repro/<project>/<issue>/` in the address bar.
 *
 * Reads the in-tree `docs/public/api/{recipes,projects}.json` (regenerated
 * by `docs/scripts/generate-recipes-index.ts` from the layer directories
 * + the `docs/data/{recipe-facets,projects}.json` overlays).
 *
 * v1 surface:
 *   - project hero (display name, tagline, description, homepage / GitHub
 *     links from the projects.json overlay, layer/recipe count chips)
 *   - issue list table with verdict layer badge + open / source links
 * ========================================================================== */

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

interface ProjectEntry {
  project: string;
  display_name: string;
  tagline?: string;
  description?: string;
  homepage?: string;
  github?: string;
  recipe_count: number;
  layers: (1 | 2 | 3)[];
  page_url: string;
}

interface ProjectsIndex {
  index: 'v1';
  projects: ProjectEntry[];
}

const RECIPES = recipesIndex as RecipesIndex;
const PROJECTS = projectsIndex as ProjectsIndex;

type Lang = 'en' | 'ja';

interface Strings {
  eyebrow: (project: string) => string;
  recipesHeading: string;
  noRecipes: string;
  noProject: (project: string) => string;
  recipeCountTemplate: (n: number) => string;
  open: string;
  source: string;
  homepage: string;
  upstream: string;
  layerName: (layer: 1 | 2 | 3) => string;
  issueLabel: string;
  titleLabel: string;
  layerLabel: string;
  linkLabel: string;
  unfiledIssue: string;
}

const STRINGS: Record<Lang, Strings> = {
  en: {
    eyebrow: (project) => `// PROJECT · ${project.toUpperCase()}`,
    recipesHeading: 'Reproductions hosted for this project',
    noRecipes: 'No reproductions are catalogued for this project yet.',
    noProject: (project) =>
      `Project "${project}" is not present in the catalogue. It may have been removed or the URL is mistyped.`,
    recipeCountTemplate: (n) =>
      n === 1 ? '1 reproduction' : `${n} reproductions`,
    open: 'Open ↗',
    source: 'Source',
    homepage: 'Homepage ↗',
    upstream: 'Upstream ↗',
    layerName: (layer) =>
      layer === 1
        ? 'L1 · WASM'
        : layer === 2
          ? 'L2 · Docker'
          : 'L3 · Record-replay',
    issueLabel: 'Issue',
    titleLabel: 'Title',
    layerLabel: 'Layer',
    linkLabel: '',
    unfiledIssue: '(no upstream issue number)',
  },
  ja: {
    eyebrow: (project) => `// プロジェクト · ${project.toUpperCase()}`,
    recipesHeading: 'このプロジェクトで提供している再現',
    noRecipes: 'このプロジェクト用の再現はまだカタログに登録されていない。',
    noProject: (project) =>
      `プロジェクト "${project}" はカタログに存在しない。削除されたか、URL が誤っている可能性がある。`,
    recipeCountTemplate: (n) => `${n} 件の再現`,
    open: '開く ↗',
    source: 'ソース',
    homepage: 'ホームページ ↗',
    upstream: 'アップストリーム ↗',
    layerName: (layer) =>
      layer === 1 ? 'L1 · WASM' : layer === 2 ? 'L2 · Docker' : 'L3 · 記録再生',
    issueLabel: 'Issue',
    titleLabel: 'タイトル',
    layerLabel: 'レイヤー',
    linkLabel: '',
    unfiledIssue: '（アップストリーム issue 番号なし）',
  },
};

function LayerPill({ lang, layer }: { lang: Lang; layer: 1 | 2 | 3 }) {
  const accent = layer === 1 ? 'teal' : layer === 2 ? 'violet' : 'coral';
  return (
    <span className={`v-pp__layer-pill v-pp__layer-pill--${accent}`}>
      {STRINGS[lang].layerName(layer)}
    </span>
  );
}

function IssueLabel({ lang, recipe }: { lang: Lang; recipe: RecipeEntry }) {
  if (recipe.issue > 0) {
    return <code>#{recipe.issue}</code>;
  }
  return <em className="v-pp__unfiled">{STRINGS[lang].unfiledIssue}</em>;
}

export function ProjectPage({
  lang,
  project,
}: {
  lang: Lang;
  project: string;
}) {
  const s = STRINGS[lang];
  const meta = useMemo(
    () => PROJECTS.projects.find((p) => p.project === project),
    [project],
  );
  const recipes = useMemo(
    () =>
      RECIPES.recipes
        .filter((r) => r.project === project)
        .sort((a, b) => {
          if (a.layer !== b.layer) return a.layer - b.layer;
          if (a.issue !== b.issue) return b.issue - a.issue;
          return a.slug.localeCompare(b.slug);
        }),
    [project],
  );

  if (!meta && recipes.length === 0) {
    return (
      <section className="v-pp">
        <p className="v-pp__eyebrow">{s.eyebrow(project)}</p>
        <p className="v-pp__empty">{s.noProject(project)}</p>
      </section>
    );
  }

  const displayName = meta?.display_name ?? project;
  const layers =
    meta?.layers ?? Array.from(new Set(recipes.map((r) => r.layer))).sort();

  return (
    <section className="v-pp">
      <header className="v-pp__hero">
        <p className="v-pp__eyebrow">{s.eyebrow(project)}</p>
        <h1 className="v-pp__title">{displayName}</h1>
        {meta?.tagline ? <p className="v-pp__tagline">{meta.tagline}</p> : null}
        {meta?.description ? (
          <p className="v-pp__description">{meta.description}</p>
        ) : null}
        <div className="v-pp__chips">
          <span className="v-pp__count-chip">
            {s.recipeCountTemplate(recipes.length)}
          </span>
          {layers.map((layer) => (
            <LayerPill key={layer} lang={lang} layer={layer} />
          ))}
        </div>
        {(meta?.homepage || meta?.github) && (
          <div className="v-pp__links">
            {meta?.homepage ? (
              <a
                className="v-pp__link"
                href={meta.homepage}
                target="_blank"
                rel="noreferrer"
              >
                {s.homepage}
              </a>
            ) : null}
            {meta?.github ? (
              <a
                className="v-pp__link"
                href={meta.github}
                target="_blank"
                rel="noreferrer"
              >
                {s.upstream}
              </a>
            ) : null}
          </div>
        )}
      </header>

      <h2 className="v-pp__section-heading">{s.recipesHeading}</h2>
      {recipes.length === 0 ? (
        <p className="v-pp__empty">{s.noRecipes}</p>
      ) : (
        <table className="v-pp__table">
          <thead>
            <tr>
              <th>{s.layerLabel}</th>
              <th>{s.issueLabel}</th>
              <th>{s.titleLabel}</th>
              <th aria-label={s.linkLabel} />
            </tr>
          </thead>
          <tbody>
            {recipes.map((recipe) => (
              <tr key={recipe.slug}>
                <td>
                  <LayerPill lang={lang} layer={recipe.layer} />
                </td>
                <td>
                  <IssueLabel lang={lang} recipe={recipe} />
                </td>
                <td>
                  <span className="v-pp__row-title">{recipe.title}</span>
                  {recipe.symptom ? (
                    <span className="v-pp__row-symptom">
                      <code>{recipe.symptom}</code>
                    </span>
                  ) : null}
                </td>
                <td className="v-pp__actions-cell">
                  <a
                    className="v-pp__btn v-pp__btn--primary"
                    href={recipe.page_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.open}
                  </a>
                  <a
                    className="v-pp__btn v-pp__btn--ghost"
                    href={recipe.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.source}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default ProjectPage;
