// MCP server wiring — registers the three v1 tools (list_recipes,
// get_recipe, lookup_verdict) and connects a stdio transport.
//
// See ADR-0019 §3 for the tool surface decision and §1 for the
// stdio-transport choice.

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

const SERVER_NAME = 'vivarium-mcp';
// Keep in sync with package.json + jsr.json. Updated by the publish
// workflow on tag push; unsynced values produce a confusing client
// experience (the MCP `initialize` response carries this string).
const SERVER_VERSION = '0.1.0';

export function createServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [LIST_RECIPES_TOOL, GET_RECIPE_TOOL, LOOKUP_VERDICT_TOOL],
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
