#!/usr/bin/env bun
//
// Walks vivarium's recipe directories under src/layer1_wasm,
// src/layer2_docker, and src/layer3_thirdway (each holding kebab-case
// recipe sub-directories) and emits docs/public/api/recipes.json — the
// catalogue index consumed by the Vivarium MCP server (ADR-0019, private
// memo) and any other programmatic tool that wants to list, filter, or
// look up reproductions.
//
// The output is tracked in git so PRs adding a recipe also show the index
// update in the diff. Run by `bun run generate-index` (wired into the
// `dev` and `build` scripts in docs/package.json).
//
// Heuristics for v1:
//   - slug = recipe directory name.
//   - project / issue = parsed from "<project>-<digits>" slug pattern;
//     for slugs without a trailing number, project = first dash-segment,
//     issue = 0.
//   - title = first H1 of the recipe README, with the leading
//     "Reproduction —" prefix stripped.
//   - language / symptom / severity / tags = merged from the facet overlay
//     at docs/data/recipe-facets.json (ADR-0024 §1+§2). Recipes without an
//     overlay row default to language: "unknown" and empty tags; the
//     gallery degrades to "show but unfilterable on language" for those.
//
// Schema is locked at `index = "v1"` per ADR-0019 §4 and follows
// ADR-0018's minor-revision policy: optional fields can be added without
// bumping the literal; breaking changes require v2.

import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES_BASE = 'https://aletheia-works.github.io/vivarium';
const REPO_BASE = 'https://github.com/aletheia-works/vivarium';

type Layer = 1 | 2 | 3;

interface RecipeEntry {
  slug: string;
  layer: Layer;
  project: string;
  issue: number;
  title: string;
  page_url: string;
  verdict_url?: string;
  source_url: string;
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

interface FacetEntry {
  language: string;
  symptom?: string;
  severity?: string;
  tags?: string[];
}

interface FacetOverlay {
  facets: Record<string, FacetEntry>;
}

const LAYERS: ReadonlyArray<{ layer: Layer; dir: string }> = [
  { layer: 1, dir: 'src/layer1_wasm' },
  { layer: 2, dir: 'src/layer2_docker' },
  { layer: 3, dir: 'src/layer3_thirdway' },
];

const LAYER_DIRNAME: Record<Layer, string> = {
  1: 'layer1_wasm',
  2: 'layer2_docker',
  3: 'layer3_thirdway',
};

const NON_RECIPE_NAMES = new Set([
  '_shared',
  '_layer2-shared',
  'node_modules',
  'tests',
  'test-results',
]);

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listRecipeSlugs(layerDir: string): Promise<string[]> {
  const entries = await readdir(layerDir);
  const slugs: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith('_') || entry.startsWith('.')) continue;
    if (NON_RECIPE_NAMES.has(entry)) continue;
    if (!(await isDir(join(layerDir, entry)))) continue;
    slugs.push(entry);
  }
  return slugs.sort();
}

// Slugs whose first dash-segment is not the upstream project name. The
// heuristic in parseSlug() works for "<project>-<digits>" and most
// "<project>-<rest>" slugs, but a handful of recipe directory names diverge
// (e.g. layer 3 "lost-update" reproduces a pthread data race, not a
// "lost" project). These overrides bridge to the day Phase 6 stream S.1
// adds explicit per-recipe frontmatter and the heuristic retires.
const PROJECT_OVERRIDES: Record<string, string> = {
  'lost-update': 'pthread',
};

function parseSlug(slug: string): { project: string; issue: number } {
  if (PROJECT_OVERRIDES[slug]) {
    return { project: PROJECT_OVERRIDES[slug]!, issue: 0 };
  }
  const match = slug.match(/^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*?)-(\d+)$/);
  if (match) {
    return { project: match[1]!, issue: Number(match[2]) };
  }
  const firstDash = slug.indexOf('-');
  return {
    project: firstDash === -1 ? slug : slug.slice(0, firstDash),
    issue: 0,
  };
}

async function readTitle(readmePath: string, fallback: string): Promise<string> {
  try {
    const md = await readFile(readmePath, 'utf-8');
    const lines = md.split(/\r?\n/);
    const h1 = lines.find((l) => l.startsWith('# '));
    if (!h1) return fallback;
    return h1
      .replace(/^#\s+/, '')
      .replace(/^Reproduction[\s—–-]+/i, '')
      .trim();
  } catch {
    return fallback;
  }
}

async function loadFacetOverlay(repoRoot: string): Promise<FacetOverlay> {
  const overlayPath = join(repoRoot, 'docs', 'data', 'recipe-facets.json');
  try {
    const raw = await readFile(overlayPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FacetOverlay>;
    if (!parsed.facets || typeof parsed.facets !== 'object') {
      console.error(
        `WARNING: ${overlayPath} did not contain a "facets" object; treating as empty overlay.`,
      );
      return { facets: {} };
    }
    return { facets: parsed.facets };
  } catch (err) {
    console.error(
      `WARNING: could not read ${overlayPath} (${err instanceof Error ? err.message : err}); treating as empty overlay.`,
    );
    return { facets: {} };
  }
}

async function buildEntry(
  layer: Layer,
  slug: string,
  recipeDir: string,
  overlay: FacetOverlay,
): Promise<RecipeEntry> {
  const { project, issue } = parseSlug(slug);
  const title = await readTitle(join(recipeDir, 'README.md'), slug);
  const pageUrl = `${PAGES_BASE}/repro/${slug}/`;
  const sourceUrl = `${REPO_BASE}/tree/main/src/${LAYER_DIRNAME[layer]}/${slug}`;
  const facet = overlay.facets[slug];
  const entry: RecipeEntry = {
    slug,
    layer,
    project,
    issue,
    title,
    page_url: pageUrl,
    source_url: sourceUrl,
    language: facet?.language ?? 'unknown',
    tags: facet?.tags ?? [],
  };
  if (facet?.symptom) entry.symptom = facet.symptom;
  if (facet?.severity) entry.severity = facet.severity;
  if (layer === 2 || layer === 3) {
    entry.verdict_url = `${PAGES_BASE}/repro/${slug}/verdict.json`;
  }
  return entry;
}

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = join(__dirname, '..', '..');

  const overlay = await loadFacetOverlay(REPO_ROOT);
  const recipes: RecipeEntry[] = [];
  for (const { layer, dir } of LAYERS) {
    const layerDir = join(REPO_ROOT, dir);
    const slugs = await listRecipeSlugs(layerDir);
    for (const slug of slugs) {
      recipes.push(await buildEntry(layer, slug, join(layerDir, slug), overlay));
    }
  }
  const missingFacets = recipes
    .filter((r) => r.language === 'unknown')
    .map((r) => r.slug);
  if (missingFacets.length > 0) {
    console.error(
      `NOTE: ${missingFacets.length} recipe(s) missing facet overlay rows; ` +
        `language defaulted to "unknown": ${missingFacets.join(', ')}`,
    );
  }

  const out: RecipesIndex = {
    index: 'v1',
    contract: 'v1',
    recipes,
  };

  const outDir = join(__dirname, '..', 'public', 'api');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'recipes.json');
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');

  const counts = recipes.reduce<Record<Layer, number>>(
    (acc, r) => {
      acc[r.layer] = (acc[r.layer] ?? 0) + 1;
      return acc;
    },
    { 1: 0, 2: 0, 3: 0 },
  );
  console.error(
    `Wrote ${recipes.length} recipe(s) to ${outPath} ` +
      `(layer 1: ${counts[1]}, layer 2: ${counts[2]}, layer 3: ${counts[3]})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
