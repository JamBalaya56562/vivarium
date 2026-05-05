#!/usr/bin/env bun
//
// Pre-tsc step for Layer 1 reproduction pages.
//
// Each `src/layer1_wasm/<slug>/repro.ts` declares a `REPRO_CODE` (or
// `REPRO_SOURCE_HINT` for compiled-language recipes) template-literal
// string that the recipe page renders inside `<pre id="repro-code">`.
// Until ADR-0028 §V′, that string was injected verbatim via
// `reproCodeEl.textContent = REPRO_CODE` — readable enough, but
// plain monochrome text on a dark background.
//
// This script extracts that template literal at build time, runs it
// through Shiki (the same highlighter rspress uses for MDX code
// blocks), and writes the rendered token HTML to
// `<slug>/repro.highlighted.html`. The recipe page upgrades from
// plain text to highlighted HTML asynchronously after first paint —
// see the `fetch('./repro.highlighted.html')` hook in each repro.ts.
//
// Wiring: invoked via `bun run build` (see this directory's
// package.json) before tsc compiles repro.ts. CI deploy reaches it
// through `mise run repro:build` → `repro:build:ts`.
//
// Failure mode: if Shiki cannot resolve a slug's language, or the
// template literal cannot be parsed, the script logs and skips that
// recipe. The recipe page's plain-text fallback path keeps working,
// so the recipe still ships a verdict — only without colouring.

import { codeToHtml, type BundledLanguage } from 'shiki';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAYER1_DIR = dirname(SCRIPT_DIR);

// Slug-prefix → Shiki language ID. The slug shape is
// `<project>-<issue>` (per AGENTS.md §4.6 / glossary), so the part
// before the first hyphen identifies the project, which in turn pins
// the source language for Layer 1 recipes.
const LANG_BY_PROJECT: Record<string, BundledLanguage> = {
  cpython: 'python',
  numpy: 'python',
  pandas: 'python',
  ruby: 'ruby',
  php: 'php',
  regex: 'rust',
};

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

// Extract a `const NAME = \`...\`(.trim())?;` template literal value
// from a TS source. Also supports `String.raw\`…\`` (used by recipes
// whose payload contains `\p{…}` and similar regex-literal escapes).
// Template substitutions (${…}) inside the literal are not supported —
// they are intentionally treated as already-substituted text, since the
// recipes that use them treat ${prefix} / ${suffix} as Ruby's literal
// `#{prefix}` etc., not as TS interpolation.
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

// Resolve TS template-literal escapes left-to-right so `\\n` in source
// stays as `\n` (literal backslash + n) rather than collapsing to a
// newline. Critical for regex-779's REPRO_SOURCE_HINT.
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

  const project = slug.split('-')[0] ?? '';
  const lang = LANG_BY_PROJECT[project];
  if (!lang) {
    console.warn(`[highlight-repros] no language for project "${project}" (slug ${slug}); skipping.`);
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

  const wrapped = await codeToHtml(code, {
    lang,
    theme: 'github-dark',
  });

  // Strip Shiki's outer `<pre class="shiki ...">…<code>` wrapper —
  // the recipe page already owns the `<pre id="repro-code">`, and
  // injecting Shiki's pre would double up the chrome. We keep the
  // inner `<code>…spans…</code>` and replace `reproCodeEl.innerHTML`
  // with it.
  const inner = wrapped
    .replace(/^[\s\S]*?<code[^>]*>/, '<code>')
    .replace(/<\/code>[\s\S]*$/, '</code>');

  const outPath = join(LAYER1_DIR, slug, 'repro.highlighted.html');
  writeFileSync(outPath, inner, 'utf-8');
  written += 1;
  console.log(`[highlight-repros] ${slug} (${lang}) -> repro.highlighted.html`);
}

console.log(`[highlight-repros] done. ${written} written, ${skipped} skipped.`);
