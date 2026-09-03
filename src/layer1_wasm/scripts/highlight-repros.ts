#!/usr/bin/env bun

import { codeToHtml, type BundledLanguage } from 'shiki';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function extractTemplateLiteral(src: string, name: string): string | null {
  const re = new RegExp(
    `const\\s+${name}\\s*=\\s*(String\\.raw)?\\s*\`([\\s\\S]*?)\``,
    'm',
  );
  const m = src.match(re);
  if (!m) return null;
  const isRaw = !!m[1];
  const raw = m[2] ?? '';
  return (isRaw ? raw : unescapeTemplate(raw)).trim();
}

function unescapeTemplate(s: string): string {
  return s.replace(/\\([\s\S])/g, (_, c) => {
    switch (c) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '\\':
        return '\\';
      case '`':
        return '`';
      case '$':
        return '$';
      default:
        return c;
    }
  });
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
  const code =
    extractTemplateLiteral(src, 'REPRO_CODE') ??
    extractTemplateLiteral(src, 'REPRO_SOURCE_HINT');
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

  const indexPath = join(LAYER1_DIR, slug, 'index.html');
  if (!existsSync(indexPath)) continue;
  const indexHtml = readFileSync(indexPath, 'utf-8');
  const innerSpans = inner
    .replace(/^<code[^>]*>/, '')
    .replace(/<\/code>\s*$/, '');
  const placeholderRe = /(<code id="repro-code"[^>]*>)([\s\S]*?)(<\/code>)/;
  const m = indexHtml.match(placeholderRe);
  if (!m) {
    console.warn(`[highlight-repros] no <code id="repro-code"> placeholder in ${slug}/index.html; skipping inline.`);
    continue;
  }
  if (m[2] === innerSpans) {
    continue;
  }
  const updated = indexHtml.replace(placeholderRe, `$1${innerSpans}$3`);
  writeFileSync(indexPath, updated, 'utf-8');
  console.log(`[highlight-repros] ${slug} -> inlined into index.html`);
}

console.log(`[highlight-repros] done. ${written} written, ${skipped} skipped.`);
