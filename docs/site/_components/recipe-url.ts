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
