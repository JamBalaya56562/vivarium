import { getCatalogue } from '../catalogue.js';
import type { Layer, RecipeEntry } from '../types.js';

export interface ListRecipesArgs {
  layer?: Layer;
  project?: string;
  q?: string;
}

export interface ListRecipesResult {
  count: number;
  recipes: RecipeEntry[];
}

export async function listRecipes(
  args: ListRecipesArgs,
): Promise<ListRecipesResult> {
  const { recipes } = await getCatalogue();

  const layer = args.layer;
  const project = args.project?.trim().toLowerCase();
  const q = args.q?.trim().toLowerCase();

  const filtered = recipes.filter((r) => {
    if (layer !== undefined && r.layer !== layer) return false;
    if (project && r.project.toLowerCase() !== project) return false;
    if (q) {
      const hay = (r.slug + ' ' + r.project + ' ' + r.title).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return { count: filtered.length, recipes: filtered };
}

export const LIST_RECIPES_TOOL = {
  name: 'list_recipes',
  description:
    'List Vivarium reproduction recipes — pages or container images that demonstrate a specific upstream bug. Returns metadata only; live verdicts come from `lookup_verdict`. Filter by `layer` (1=WASM in browser, 2=Docker, 3=record-replay), `project` (upstream project name like "pandas" or "bash"), or `q` (substring search across slug, project, and title).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      layer: {
        type: 'integer' as const,
        enum: [1, 2, 3],
        description:
          'Optional layer filter. 1 = WASM in browser, 2 = Docker, 3 = record-replay.',
      },
      project: {
        type: 'string' as const,
        description:
          "Optional upstream project name (e.g. 'pandas', 'bash'). Case-insensitive exact match.",
      },
      q: {
        type: 'string' as const,
        description:
          'Optional substring search across slug, project, and title. Case-insensitive.',
      },
    },
  },
} as const;
