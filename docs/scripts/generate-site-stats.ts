#!/usr/bin/env bun
//
// Aggregates a small set of "headline numbers" the docs site references
// (currently: total recipes, distinct execution layers, MCP tool count)
// into docs/site/_generated/site-stats.json. Run after
// generate-recipes-index.ts so the recipe figure stays in lock-step with
// docs/site/public/api/recipes.json.
//
// Why this exists: the roadmap page used to hard-code these counts, so
// every recipe or MCP tool added required a parallel doc edit and was
// silently easy to forget. The JSON written here is imported by the
// roadmap MDX pages (EN / JA) and any future page that needs the same
// figures.
//
// Sources of truth:
//   - recipes / layers : docs/site/public/api/recipes.json (generated upstream)
//   - mcpTools         : packages/mcp-server/src/tools/*.ts file count
//   - locales          : docs/site/<locale>/ directory count
//
// The output is gitignored and regenerated before dev/build so recipe PRs do
// not need to carry derivative stats churn.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  REPO_ROOT,
  SITE_API_DIR,
  SITE_ROOT,
  SITE_STATS_PATH,
} from './site-paths';

const RECIPES_INDEX = join(SITE_API_DIR, 'recipes.json');
const MCP_TOOLS_DIR = join(REPO_ROOT, 'packages', 'mcp-server', 'src', 'tools');

const KNOWN_LOCALES = new Set(['en', 'ja']);

interface RecipesIndex {
  recipes: { layer: number }[];
}

interface SiteStats {
  recipes: number;
  layers: number;
  mcpTools: number;
  locales: number;
}

async function countMcpTools(): Promise<number> {
  const entries = await readdir(MCP_TOOLS_DIR);
  return entries.filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  ).length;
}

async function countLocales(): Promise<number> {
  const entries = await readdir(SITE_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && KNOWN_LOCALES.has(e.name))
    .length;
}

async function main() {
  const recipesRaw = await readFile(RECIPES_INDEX, 'utf-8');
  const recipesIndex = JSON.parse(recipesRaw) as RecipesIndex;
  const recipes = recipesIndex.recipes.length;
  const layers = new Set(recipesIndex.recipes.map((r) => r.layer)).size;
  const mcpTools = await countMcpTools();
  const locales = await countLocales();

  const stats: SiteStats = { recipes, layers, mcpTools, locales };
  await mkdir(dirname(SITE_STATS_PATH), { recursive: true });
  await writeFile(
    SITE_STATS_PATH,
    `${JSON.stringify(stats, null, 2)}\n`,
    'utf-8',
  );
  console.error(
    `Wrote site stats: recipes=${recipes}, layers=${layers}, mcpTools=${mcpTools}, locales=${locales}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
