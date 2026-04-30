import { getCatalogue } from '../catalogue.js';
import type { RecipeEntry } from '../types.js';

export interface GetRecipeArgs {
  slug: string;
}

export type GetRecipeResult =
  | { found: true; recipe: RecipeEntry }
  | { found: false; error: string };

export async function getRecipe(
  args: GetRecipeArgs,
): Promise<GetRecipeResult> {
  const slug = args.slug?.trim();
  if (!slug) {
    return { found: false, error: 'missing required argument: slug' };
  }
  const { recipes } = await getCatalogue();
  const recipe = recipes.find((r) => r.slug === slug);
  if (!recipe) {
    return { found: false, error: `recipe not found: ${slug}` };
  }
  return { found: true, recipe };
}

export const GET_RECIPE_TOOL = {
  name: 'get_recipe',
  description:
    'Get full metadata for a single recipe by slug, including the live page URL, verdict snapshot URL (Layer 2/3), and GitHub source URL. Use `list_recipes` first to discover available slugs. Returns `found: false` with an error message if the slug is unknown.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      slug: {
        type: 'string' as const,
        pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
        description:
          "Kebab-case recipe slug (e.g. 'pandas-56679', 'bash-local-shadows-exit'). Same convention as Manifest v1's `slug`.",
      },
    },
    required: ['slug'],
  },
} as const;
