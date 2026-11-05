export type Lang = 'en' | 'ja';

export interface RecipeUrlFields {
  page_url?: string;
  page_url_ja?: string;
  preview_url?: string;
}

export interface RecipeSourceFields {
  preview_url?: string;
  pull_url?: string;
  commit_url?: string;
  source_url: string;
}

export function recipeSourceUrl(recipe: RecipeSourceFields): string {
  if (!recipe.preview_url) return recipe.source_url;
  return recipe.pull_url ?? recipe.commit_url ?? recipe.source_url;
}

export function recipeUrl(recipe: RecipeUrlFields, lang: Lang = 'en'): string {
  if (recipe.preview_url) return recipe.preview_url;
  const url =
    (lang === 'ja' ? recipe.page_url_ja : undefined) ?? recipe.page_url ?? '';
  if (typeof window === 'undefined') return url;
  try {
    const u = new URL(url);
    return window.location.origin + u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}
