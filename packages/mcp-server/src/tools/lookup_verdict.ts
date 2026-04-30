import { fetchVerdictSnapshot, getCatalogue } from '../catalogue.js';
import type { VerdictSnapshot } from '../types.js';

export interface LookupVerdictArgs {
  slug: string;
}

export type LookupVerdictResult =
  | {
      kind: 'live';
      slug: string;
      page_url: string;
      note: string;
    }
  | {
      kind: 'snapshot';
      slug: string;
      snapshot: VerdictSnapshot;
    }
  | {
      kind: 'unavailable';
      slug: string;
      reason: string;
    }
  | {
      kind: 'not_found';
      slug: string;
      error: string;
    };

export async function lookupVerdict(
  args: LookupVerdictArgs,
): Promise<LookupVerdictResult> {
  const slug = args.slug?.trim();
  if (!slug) {
    return {
      kind: 'not_found',
      slug: '',
      error: 'missing required argument: slug',
    };
  }

  const { recipes } = await getCatalogue();
  const recipe = recipes.find((r) => r.slug === slug);
  if (!recipe) {
    return {
      kind: 'not_found',
      slug,
      error: `recipe not found: ${slug}`,
    };
  }

  if (recipe.layer === 1) {
    return {
      kind: 'live',
      slug,
      page_url: recipe.page_url,
      note:
        'Layer 1 reproductions produce verdicts live in the browser; the agent can open the page or delegate to a browser MCP to obtain an actual verdict.',
    };
  }

  if (!recipe.verdict_url) {
    return {
      kind: 'unavailable',
      slug,
      reason: 'recipe entry has no verdict_url',
    };
  }

  const snapshot = await fetchVerdictSnapshot(recipe.verdict_url);
  if (!snapshot) {
    return {
      kind: 'unavailable',
      slug,
      reason: `verdict snapshot fetch failed or returned non-v1 data: ${recipe.verdict_url}`,
    };
  }

  return { kind: 'snapshot', slug, snapshot };
}

export const LOOKUP_VERDICT_TOOL = {
  name: 'lookup_verdict',
  description:
    "Look up the latest verdict for a recipe by slug. Layer 1 recipes produce live in-browser verdicts and have no static snapshot — this returns kind='live' with the page URL and a note suggesting the agent open the page directly. Layer 2/3 recipes return kind='snapshot' with the deployed verdict.json contents (verdict, exit code, image digest, captured-at timestamp, stdout, stderr tail). Returns kind='unavailable' or kind='not_found' on failure.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      slug: {
        type: 'string' as const,
        pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
        description: 'Kebab-case recipe slug.',
      },
    },
    required: ['slug'],
  },
} as const;
