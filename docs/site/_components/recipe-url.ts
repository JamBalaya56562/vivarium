// Resolve the URL a gallery card's "Open" button should point at.
//
// Two jobs, previously done by three hand-copied `localizeRecipeUrl`
// functions (ProjectPage, RecipeGallery, LiveExamples) plus one call site
// that skipped them entirely (ErrorRecipeMatcher, which used the raw
// `page_url`):
//
//  1. Host. `recipes.json` bakes in the production Pages origin. When the
//     same index is served from somewhere else — local rspress dev, an
//     rspress preview, a fork's own Pages deploy — the link has to point
//     at the current host instead of sending the visitor upstream. Only
//     the origin is swapped; the pathname is preserved verbatim. SSR is
//     left untouched (there is no `window` to read).
//
//  2. Locale. A visitor reading the Japanese gallery should land on the
//     Japanese reproduction page. That URL is published as `page_url_ja`
//     and is only present when the recipe actually ships a translation,
//     so an untranslated recipe correctly falls back to the English page
//     rather than being sent to a 404 derived by inserting `/ja/`.

export type Lang = 'en' | 'ja';

export interface RecipeUrlFields {
  page_url: string;
  page_url_ja?: string;
}

export function recipeUrl(recipe: RecipeUrlFields, lang: Lang = 'en'): string {
  const url =
    lang === 'ja' ? (recipe.page_url_ja ?? recipe.page_url) : recipe.page_url;
  if (typeof window === 'undefined') return url;
  try {
    const u = new URL(url);
    return window.location.origin + u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}
