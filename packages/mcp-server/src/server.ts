// MCP server wiring — registers the v1 tools and connects a stdio
// transport. The tool surface is documented in README.md; each tool
// module owns its own description literal.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { GET_RECIPE_TOOL, getRecipe } from './tools/get_recipe.js';
import {
  LIST_RECIPES_TOOL,
  listRecipes,
  type ListRecipesArgs,
} from './tools/list_recipes.js';
import {
  LOOKUP_VERDICT_TOOL,
  lookupVerdict,
} from './tools/lookup_verdict.js';
import {
  MATCH_ERROR_TOOL,
  matchError,
  type MatchErrorArgs,
} from './tools/match_error.js';
import {
  PREPARE_FIX_CANDIDATE_TOOL,
  prepareFixCandidate,
  type PrepareFixCandidateArgs,
} from './tools/prepare_fix_candidate.js';
import {
  PREPARE_NEW_RECIPE_TOOL,
  prepareNewRecipe,
  type PrepareNewRecipeArgs,
} from './tools/prepare_new_recipe.js';
import {
  VERIFY_BRANCH_FIX_TOOL,
  verifyBranchFix,
  type VerifyBranchFixArgs,
} from './tools/verify_branch_fix.js';

const SERVER_NAME = 'vivarium-mcp';
// Keep in sync with package.json + jsr.json. The MCP `initialize`
// handshake exposes this string to clients, so unsynced values across
// these three files produce a confusing client experience. Bump the
// patch component for additive changes within v0.x (additional tools,
// description / surface refinements) — the project is still pre-1.0
// and `prepare_fix_candidate` is meaningful but fully opt-in, so a minor
// bump would overstate the impact.
const SERVER_VERSION = '0.1.1';

export function createServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      LIST_RECIPES_TOOL,
      GET_RECIPE_TOOL,
      LOOKUP_VERDICT_TOOL,
      MATCH_ERROR_TOOL,
      VERIFY_BRANCH_FIX_TOOL,
      PREPARE_NEW_RECIPE_TOOL,
      PREPARE_FIX_CANDIDATE_TOOL,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    let payload: unknown;
    try {
      switch (name) {
        case 'list_recipes':
          payload = await listRecipes(args as ListRecipesArgs);
          break;
        case 'get_recipe':
          payload = await getRecipe(args as { slug: string });
          break;
        case 'lookup_verdict':
          payload = await lookupVerdict(args as { slug: string });
          break;
        case 'match_error':
          payload = await matchError(args as unknown as MatchErrorArgs);
          break;
        case 'verify_branch_fix':
          payload = await verifyBranchFix(
            args as unknown as VerifyBranchFixArgs,
          );
          break;
        case 'prepare_new_recipe':
          payload = await prepareNewRecipe(
            args as unknown as PrepareNewRecipeArgs,
          );
          break;
        case 'prepare_fix_candidate':
          payload = await prepareFixCandidate(
            args as unknown as PrepareFixCandidateArgs,
          );
          break;
        default:
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `unknown tool: ${name}`,
              },
            ],
          };
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `tool ${name} threw: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
