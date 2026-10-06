#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from './site-paths';

const LAYER_DIRS = ['layer1_wasm', 'layer2_docker'].map((layer) =>
  join(REPO_ROOT, 'src', layer),
);
const HERO_PATH = join(
  REPO_ROOT,
  'docs',
  'site',
  '_components',
  'VivariumHero.tsx',
);
const PULL_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

interface Tracked {
  slug: string;
  dir: string;
  pr: string;
}

function readJson<T>(path: string): T | undefined {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf-8')) as T)
    : undefined;
}

function upstreamPrOf(dir: string): string | undefined {
  const declared = readJson<{ upstream_pr?: string }>(
    join(dir, 'recipe.json'),
  )?.upstream_pr;
  const wheel = readJson<{ upstream_pr?: string }>(
    join(dir, 'fix-candidate.json'),
  )?.upstream_pr;
  if (declared && wheel && declared !== wheel) {
    throw new Error(
      `${relative(REPO_ROOT, dir)} names two upstream pull requests: ${declared} in recipe.json and ${wheel} in fix-candidate.json`,
    );
  }
  return declared || wheel || undefined;
}

function tracked(): Tracked[] {
  return LAYER_DIRS.flatMap((layerDir) =>
    readdirSync(layerDir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'),
      )
      .map((e) => e.name)
      .sort()
      .flatMap((slug) => {
        const dir = join(layerDir, slug);
        if (!existsSync(join(dir, 'recipe.json'))) return [];
        const pr = upstreamPrOf(dir);
        return pr ? [{ slug, dir, pr }] : [];
      }),
  );
}

async function mergedAt(pr: string): Promise<string | null> {
  const m = PULL_URL.exec(pr);
  if (!m) throw new Error(`${pr} is not a GitHub pull request URL`);
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `https://api.github.com/repos/${m[1]}/${m[2]}/pulls/${m[3]}`,
    { headers },
  );
  if (!res.ok) throw new Error(`${pr} returned ${res.status}`);
  return ((await res.json()) as { merged_at: string | null }).merged_at;
}

async function retire(slug: string): Promise<void> {
  const recipe = tracked().find((r) => r.slug === slug);
  if (!recipe) throw new Error(`${slug} tracks no upstream pull request`);
  const merged = await mergedAt(recipe.pr);
  if (!merged) return;
  if (readFileSync(HERO_PATH, 'utf-8').includes(slug)) {
    console.error(
      `::warning::${recipe.pr} was merged, but ${slug} is pinned to the landing-page hero; hand it over to another recipe in ${relative(REPO_ROOT, HERO_PATH)} before retiring it.`,
    );
    return;
  }
  rmSync(recipe.dir, { recursive: true });
  console.log(
    `${recipe.pr} was merged on ${merged.slice(0, 10)}, so the bug \`${slug}\` reproduces is fixed upstream. This removes the recipe from \`${relative(REPO_ROOT, recipe.dir)}\` and regenerates the recipe index.`,
  );
}

const [arg] = process.argv.slice(2);
if (arg === '--list') {
  console.log(
    tracked()
      .map((r) => `${r.slug}\t${r.pr}`)
      .join('\n'),
  );
} else if (arg) {
  await retire(arg);
} else {
  console.error('usage: retire-merged-recipes.ts --list | <slug>');
  process.exit(2);
}
