#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT, SITE_API_DIR, SITE_DATA_DIR } from './site-paths';

const RECIPE_META_FILE = 'recipe.json';

const OWNER = process.env.GITHUB_REPOSITORY_OWNER ?? 'aletheia-works';
const REPO_NAME = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'vivarium';

const PAGES_BASE = `https://${OWNER}.github.io/${REPO_NAME}`;
const REPO_BASE = `https://github.com/${OWNER}/${REPO_NAME}`;

type Layer = 1 | 2 | 3;

interface RoundtripState {
  schema_version: 1;
  slug: string;
  upstream_issue: string;
  vivarium_pr?: string | null;
  fork?: {
    owner: string;
    repo: string;
    branch: string;
    image_tag?: string;
  } | null;
  upstream_pr?: string | null;
  verdicts?: {
    unfixed?: { verdict: string; captured_at: string; source: string };
    fixed?: { verdict: string; captured_at: string; source: string };
  };
  status: string;
  updated_at: string;
  notes?: string[];
}

interface RecipeEntry {
  slug: string;
  layer: Layer;
  project: string;
  issue: number;
  title: string;
  page_url: string;
  page_url_ja?: string;
  verdict_url?: string;
  source_url: string;
  language: string;
  symptom?: string;
  severity?: string;
  tags: string[];
  expected_verdict?: string;
  expected_runtime?: string;
  path_a?: boolean;
  roundtrip?: RoundtripState;
}

interface RecipesIndex {
  index: 'v1';
  contract: 'v1';
  recipes: RecipeEntry[];
}

interface RecipeMeta {
  schema_version: 1;
  language: string;
  symptom?: string;
  severity?: string;
  tags?: string[];
  expected_verdict?: string;
  expected_runtime?: string;
  path_a?: boolean;
}

interface ProjectMetaEntry {
  display_name?: string;
  tagline?: string;
  tagline_ja?: string;
  description?: string;
  description_ja?: string;
  homepage?: string;
  github?: string;
}

interface ProjectsOverlay {
  projects: Record<string, ProjectMetaEntry>;
}

interface ProjectEntry {
  project: string;
  display_name: string;
  tagline?: string;
  tagline_ja?: string;
  description?: string;
  description_ja?: string;
  homepage?: string;
  github?: string;
  recipe_count: number;
  layers: Layer[];
  page_url: string;
}

interface ProjectsIndex {
  index: 'v1';
  projects: ProjectEntry[];
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
  'scripts',
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

function parseSlug(slug: string): {
  project: string;
  issue: number;
  issuePath: string;
} {
  const match = slug.match(/^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*?)-(\d+)$/);
  if (match) {
    return {
      project: match[1]!,
      issue: Number(match[2]),
      issuePath: match[2]!,
    };
  }
  const firstDash = slug.indexOf('-');
  if (firstDash === -1) {
    return { project: slug, issue: 0, issuePath: slug };
  }
  return {
    project: slug.slice(0, firstDash),
    issue: 0,
    issuePath: slug.slice(firstDash + 1),
  };
}

async function loadRoundtripState(
  recipeDir: string,
  expectedSlug: string,
): Promise<RoundtripState | undefined> {
  const path = join(recipeDir, 'roundtrip.json');
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as RoundtripState;
    if (parsed.schema_version !== 1) {
      console.error(
        `WARNING: ${path}: schema_version != 1 (got ${parsed.schema_version}); skipping merge.`,
      );
      return undefined;
    }
    if (typeof parsed.slug !== 'string' || parsed.slug !== expectedSlug) {
      console.error(
        `WARNING: ${path}: slug "${parsed.slug}" does not match directory name "${expectedSlug}"; skipping merge.`,
      );
      return undefined;
    }
    if (
      typeof parsed.upstream_issue !== 'string' ||
      parsed.upstream_issue.length === 0
    ) {
      console.error(
        `WARNING: ${path}: upstream_issue missing or empty; skipping merge.`,
      );
      return undefined;
    }
    if (typeof parsed.status !== 'string' || parsed.status.length === 0) {
      console.error(
        `WARNING: ${path}: status missing or empty; skipping merge.`,
      );
      return undefined;
    }
    if (
      typeof parsed.updated_at !== 'string' ||
      parsed.updated_at.length === 0
    ) {
      console.error(
        `WARNING: ${path}: updated_at missing or empty; skipping merge.`,
      );
      return undefined;
    }
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    console.error(
      `WARNING: could not read ${path} (${err instanceof Error ? err.message : err}); skipping roundtrip merge.`,
    );
    return undefined;
  }
}

async function readTitle(
  readmePath: string,
  fallback: string,
): Promise<string> {
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

async function loadRecipeMeta(
  recipeDir: string,
): Promise<RecipeMeta | undefined> {
  const path = join(recipeDir, RECIPE_META_FILE);
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RecipeMeta>;
    if (parsed.schema_version !== 1) {
      console.error(
        `WARNING: ${path}: schema_version != 1 (got ${parsed.schema_version}); skipping merge.`,
      );
      return undefined;
    }
    if (typeof parsed.language !== 'string' || parsed.language.length === 0) {
      console.error(
        `WARNING: ${path}: language missing or empty; skipping merge.`,
      );
      return undefined;
    }
    return parsed as RecipeMeta;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    console.error(
      `WARNING: could not read ${path} (${err instanceof Error ? err.message : err}); skipping recipe.json merge.`,
    );
    return undefined;
  }
}

async function loadProjectsOverlay(): Promise<ProjectsOverlay> {
  const overlayPath = join(SITE_DATA_DIR, 'projects.json');
  try {
    const raw = await readFile(overlayPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProjectsOverlay>;
    if (!parsed.projects || typeof parsed.projects !== 'object') {
      console.error(
        `WARNING: ${overlayPath} did not contain a "projects" object; treating as empty overlay.`,
      );
      return { projects: {} };
    }
    return { projects: parsed.projects };
  } catch (err) {
    console.error(
      `WARNING: could not read ${overlayPath} (${err instanceof Error ? err.message : err}); treating as empty overlay.`,
    );
    return { projects: {} };
  }
}

function aggregateProjects(
  recipes: RecipeEntry[],
  overlay: ProjectsOverlay,
): ProjectEntry[] {
  const buckets = new Map<string, { layers: Set<Layer>; count: number }>();
  for (const r of recipes) {
    const bucket = buckets.get(r.project) ?? { layers: new Set(), count: 0 };
    bucket.layers.add(r.layer);
    bucket.count += 1;
    buckets.set(r.project, bucket);
  }
  const projects: ProjectEntry[] = [];
  for (const [project, bucket] of buckets) {
    const meta = overlay.projects[project] ?? {};
    const entry: ProjectEntry = {
      project,
      display_name: meta.display_name ?? project,
      recipe_count: bucket.count,
      layers: Array.from(bucket.layers).sort(),
      page_url: `${PAGES_BASE}/repro/${project}/`,
    };
    if (meta.tagline) entry.tagline = meta.tagline;
    if (meta.tagline_ja) entry.tagline_ja = meta.tagline_ja;
    if (meta.description) entry.description = meta.description;
    if (meta.description_ja) entry.description_ja = meta.description_ja;
    if (meta.homepage) entry.homepage = meta.homepage;
    if (meta.github) entry.github = meta.github;
    projects.push(entry);
  }
  projects.sort((a, b) => a.project.localeCompare(b.project));
  return projects;
}

async function buildEntry(
  layer: Layer,
  slug: string,
  recipeDir: string,
): Promise<RecipeEntry> {
  const { project, issue, issuePath } = parseSlug(slug);
  const title = await readTitle(join(recipeDir, 'README.md'), slug);
  const pageUrl = `${PAGES_BASE}/repro/${project}/${issuePath}/`;
  const sourceUrl = `${REPO_BASE}/tree/main/src/${LAYER_DIRNAME[layer]}/${slug}`;
  const meta = await loadRecipeMeta(recipeDir);
  const entry: RecipeEntry = {
    slug,
    layer,
    project,
    issue,
    title,
    page_url: pageUrl,
    source_url: sourceUrl,
    language: meta?.language ?? 'unknown',
    tags: meta?.tags ?? [],
  };
  if (meta?.symptom) entry.symptom = meta.symptom;
  if (meta?.severity) entry.severity = meta.severity;
  if (meta?.expected_verdict) entry.expected_verdict = meta.expected_verdict;
  if (meta?.expected_runtime) entry.expected_runtime = meta.expected_runtime;
  if (meta?.path_a) entry.path_a = true;
  if (existsSync(join(recipeDir, 'i18n.ja.json'))) {
    entry.page_url_ja = `${PAGES_BASE}/ja/repro/${project}/${issuePath}/`;
  }
  if (layer === 2 || layer === 3) {
    entry.verdict_url = `${PAGES_BASE}/repro/${project}/${issuePath}/verdict.json`;
  }
  const roundtrip = await loadRoundtripState(recipeDir, slug);
  if (roundtrip) entry.roundtrip = roundtrip;
  return entry;
}

async function main(): Promise<void> {
  const projectsOverlay = await loadProjectsOverlay();
  const recipes: RecipeEntry[] = [];
  for (const { layer, dir } of LAYERS) {
    const layerDir = join(REPO_ROOT, dir);
    const slugs = await listRecipeSlugs(layerDir);
    for (const slug of slugs) {
      recipes.push(await buildEntry(layer, slug, join(layerDir, slug)));
    }
  }
  const missingMeta = recipes
    .filter((r) => r.language === 'unknown')
    .map((r) => r.slug);
  if (missingMeta.length > 0) {
    console.error(
      `NOTE: ${missingMeta.length} recipe(s) missing recipe.json; ` +
        `language defaulted to "unknown": ${missingMeta.join(', ')}`,
    );
  }

  const out: RecipesIndex = {
    index: 'v1',
    contract: 'v1',
    recipes,
  };

  const projects = aggregateProjects(recipes, projectsOverlay);
  const projectsOut: ProjectsIndex = {
    index: 'v1',
    projects,
  };
  const missingProjectMeta = projects
    .filter((p) => p.display_name === p.project && !p.tagline && !p.description)
    .map((p) => p.project);
  if (missingProjectMeta.length > 0) {
    console.error(
      `NOTE: ${missingProjectMeta.length} project(s) missing projects.json overlay rows; ` +
        `landing pages will fall back to slug-as-display-name: ${missingProjectMeta.join(', ')}`,
    );
  }

  const outDir = SITE_API_DIR;
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'recipes.json');
  await writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf-8');
  const projectsPath = join(outDir, 'projects.json');
  await writeFile(
    projectsPath,
    `${JSON.stringify(projectsOut, null, 2)}\n`,
    'utf-8',
  );

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
  console.error(`Wrote ${projects.length} project(s) to ${projectsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
