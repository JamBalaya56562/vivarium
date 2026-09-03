#!/usr/bin/env bun

import { codeToHtml, type BundledLanguage } from 'shiki';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReproSource } from './repro-source';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAYER1_DIR = dirname(SCRIPT_DIR);

function readRecipeLanguage(recipeDir: string): BundledLanguage | null {
  const recipePath = join(recipeDir, 'recipe.json');
  if (!existsSync(recipePath)) return null;
  try {
    const meta = JSON.parse(readFileSync(recipePath, 'utf-8'));
    if (typeof meta?.language === 'string' && meta.language.length > 0) {
      return meta.language as BundledLanguage;
    }
  } catch (err) {
    console.warn(
      `[highlight-repros] failed to parse ${recipePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return null;
}

const SKIP_DIRS = new Set([
  'node_modules',
  'scripts',
  'tests',
  'playwright-report',
  'test-results',
  'blob-report',
]);

function looksLikeRecipe(name: string): boolean {
  if (name.startsWith('_') || name.startsWith('.')) return false;
  if (SKIP_DIRS.has(name)) return false;
  return true;
}

const slugs = readdirSync(LAYER1_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && looksLikeRecipe(e.name))
  .map((e) => e.name)
  .sort();

let written = 0;
let skipped = 0;

for (const slug of slugs) {
  const reproPath = join(LAYER1_DIR, slug, 'repro.ts');
  if (!existsSync(reproPath)) continue;

  const recipeDir = join(LAYER1_DIR, slug);
  const lang = readRecipeLanguage(recipeDir);
  if (!lang) {
    console.warn(
      `[highlight-repros] no recipe.json#/language for slug "${slug}"; skipping.`,
    );
    skipped += 1;
    continue;
  }

  const src = readFileSync(reproPath, 'utf-8');
  const code = extractReproSource(src);
  if (!code) {
    console.warn(`[highlight-repros] no REPRO_CODE/REPRO_SOURCE_HINT in ${slug}/repro.ts; skipping.`);
    skipped += 1;
    continue;
  }

  let wrapped: string;
  try {
    wrapped = await codeToHtml(code, {
      lang,
      theme: 'github-dark',
    });
  } catch (err) {
    console.warn(
      `[highlight-repros] Shiki rejected language "${lang}" for slug "${slug}": ${err instanceof Error ? err.message : String(err)}; skipping.`,
    );
    skipped += 1;
    continue;
  }

  const inner = wrapped
    .replace(/^[\s\S]*?<code[^>]*>/, '<code>')
    .replace(/<\/code>[\s\S]*$/, '</code>');

  const outPath = join(LAYER1_DIR, slug, 'repro.highlighted.html');
  writeFileSync(outPath, inner, 'utf-8');
  written += 1;
  console.log(`[highlight-repros] ${slug} (${lang}) -> repro.highlighted.html`);
}

console.log(`[highlight-repros] done. ${written} written, ${skipped} skipped.`);
