#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'node-html-parser';
import { extractReproSource } from '../../src/layer1_wasm/scripts/repro-source';
import { REPO_ROOT, SITE_API_DIR, SITE_DATA_DIR } from './site-paths';

const LAYER1_DIR = join(REPO_ROOT, 'src', 'layer1_wasm');
const LAYER2_DIR = join(REPO_ROOT, 'src', 'layer2_docker');

interface RecipeIndexEntry {
  slug: string;
  layer: number;
  project: string;
  issue: number;
  title: string;
}

interface RuntimeShell {
  head: string;
  kicker: string;
  verdictPending: string;
}

function loaderConstant(file: string, name: string): string {
  const body = readFileSync(join(LAYER1_DIR, '_shared', file), 'utf-8');
  const match = body.match(
    new RegExp(`export const ${name}\\s*=\\s*["']([^"']+)["']`),
  );
  if (!match) {
    throw new Error(`${name} not found in _shared/${file}`);
  }
  return match[1] as string;
}

function modulePreload(href: string): string {
  return [
    '    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />',
    '    <link',
    '      rel="modulepreload"',
    `      href="${href}"`,
    '      crossorigin',
    '    />',
  ].join('\n');
}

function runtimeShells(): Record<string, RuntimeShell> {
  const pyodide = loaderConstant('loader.ts', 'DEFAULT_PYODIDE_VERSION');
  const php = loaderConstant('php_loader.ts', 'DEFAULT_PHP_WASM_VERSION');
  const ruby = loaderConstant('ruby_loader.ts', 'DEFAULT_RUBY_WASM_VERSION');
  const wasi = loaderConstant('rust_loader.ts', 'DEFAULT_WASI_SHIM_VERSION');
  const pyodideBase = `https://cdn.jsdelivr.net/pyodide/v${pyodide}/full`;
  return {
    pyodide: {
      head: [
        `    <link rel="preload" href="${pyodideBase}/pyodide.asm.wasm" as="fetch" type="application/wasm" crossorigin />`,
        `    <link rel="preload" href="${pyodideBase}/python_stdlib.zip" as="fetch" crossorigin />`,
        `    <link rel="preload" href="${pyodideBase}/pyodide-lock.json" as="fetch" type="application/json" crossorigin />`,
        modulePreload(`${pyodideBase}/pyodide.mjs`),
      ].join('\n'),
      kicker: 'L1 · Pyodide',
      verdictPending: 'Loading Pyodide runtime…',
    },
    'php-wasm': {
      head: modulePreload(
        `https://cdn.jsdelivr.net/npm/php-wasm@${php}/PhpWeb.mjs`,
      ),
      kicker: 'L1 · php-wasm',
      verdictPending: 'Loading php-wasm runtime…',
    },
    'ruby.wasm': {
      head: modulePreload(
        `https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@${ruby}/dist/browser/+esm`,
      ),
      kicker: 'L1 · Ruby.wasm',
      verdictPending: 'Loading Ruby.wasm runtime…',
    },
    'rust-wasi': {
      head: modulePreload(
        `https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@${wasi}/dist/index.js`,
      ),
      kicker: 'L1 · Rust wasm32-wasip1',
      verdictPending: 'Loading Rust wasm32-wasip1 artefact via WASI shim…',
    },
  };
}

function readSlots(path: string): Record<string, string> {
  const root = parse(readFileSync(path, 'utf-8'));
  const slots: Record<string, string> = {};
  for (const node of root.querySelectorAll('template[data-slot]')) {
    const name = node.getAttribute('data-slot');
    if (!name) continue;
    if (slots[name] !== undefined) {
      throw new Error(`${path}: duplicate slot "${name}"`);
    }
    slots[name] = node.innerHTML.replace(/^\n/, '').replace(/\s+$/, '');
  }
  return slots;
}

function indent(block: string, spaces: number): string {
  if (!block) return '';
  const pad = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((line) => (line.trim().length > 0 ? pad + line.trimEnd() : ''))
    .join('\n');
}

function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  const leftover = out.match(/\{\{[A-Z_]+\}\}/);
  if (leftover && !Object.values(values).some((v) => v.includes(leftover[0]))) {
    throw new Error(`unfilled placeholder ${leftover[0]}`);
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const unhighlighted: string[] = [];

function reproCode(recipeDir: string, slug: string): string {
  const highlighted = join(recipeDir, 'repro.highlighted.html');
  if (existsSync(highlighted)) {
    return readFileSync(highlighted, 'utf-8')
      .trim()
      .replace(/^<code[^>]*>/, '')
      .replace(/<\/code>$/, '');
  }
  const reproTs = join(recipeDir, 'repro.ts');
  const source = existsSync(reproTs)
    ? extractReproSource(readFileSync(reproTs, 'utf-8'))
    : null;
  if (!source) return '';
  unhighlighted.push(slug);
  return escapeHtml(source);
}

function fixChip(recipeDir: string): string {
  const path = join(recipeDir, 'fix-candidate.json');
  if (!existsSync(path)) return '';
  const spec = JSON.parse(readFileSync(path, 'utf-8')) as {
    source?: { url?: string; ref?: string };
  };
  const url = spec.source?.url;
  const ref = spec.source?.ref;
  if (!url || !ref) return '';
  return [
    `            <a class="vh-chip" href="${url}/tree/${ref}" target="_blank" rel="noreferrer" data-i18n="chip.fixCandidate">`,
    '              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>',
    '              Fix candidate branch',
    '            </a>',
  ].join('\n');
}

const recipeIndex = JSON.parse(
  readFileSync(join(SITE_API_DIR, 'recipes.json'), 'utf-8'),
) as { recipes: RecipeIndexEntry[] };
const bySlug = new Map(recipeIndex.recipes.map((r) => [r.slug, r]));

const projects = (
  JSON.parse(readFileSync(join(SITE_DATA_DIR, 'projects.json'), 'utf-8')) as {
    projects: Record<string, { github?: string }>;
  }
).projects;

const shells = runtimeShells();

function recipeSlugs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(dir, name, 'page.en.html')))
    .sort();
}

let written = 0;

function renderLayer1(): void {
  const template = readFileSync(
    join(LAYER1_DIR, '_shared', 'page.template.html'),
    'utf-8',
  );
  for (const slug of recipeSlugs(LAYER1_DIR)) {
    const dir = join(LAYER1_DIR, slug);
    const slots = readSlots(join(dir, 'page.en.html'));
    const entry = bySlug.get(slug);
    if (!entry) {
      throw new Error(`${slug}: no entry in recipes.json`);
    }
    const meta = JSON.parse(
      readFileSync(join(dir, 'recipe.json'), 'utf-8'),
    ) as { expected_runtime?: string };
    const runtime = meta.expected_runtime ?? 'pyodide';
    const shell = shells[runtime];
    if (!shell) {
      throw new Error(`${slug}: unknown expected_runtime "${runtime}"`);
    }
    const github = projects[entry.project]?.github;
    const upstream =
      slots['upstream-url'] ??
      (github ? `${github}/issues/${entry.issue}` : undefined);
    if (!upstream) {
      throw new Error(
        `${slug}: no upstream URL — add an "upstream-url" slot or a github entry for "${entry.project}" in projects.json`,
      );
    }
    const page = fill(template, {
      TITLE: entry.title,
      PROJECT: entry.title.split('#')[0] as string,
      ISSUE: String(entry.issue),
      RUNTIME_HEAD: shell.head,
      RUNTIME_LABEL: slots['runtime-label'] ?? '',
      KICKER: slots.kicker ?? shell.kicker,
      SCRIPT_HEADING: slots['script-heading'] ?? 'Reproduction script',
      UPSTREAM_URL: upstream,
      VERDICT_PENDING: shell.verdictPending,
      DRAWER_BODY: indent(slots['drawer-body'] ?? '', 8),
      FIX_CHIP: fixChip(dir),
      REPRO_CODE: reproCode(dir, slug),
      FIX_PANE: indent(slots['fix-pane'] ?? '', 10),
      EXTRA_SECTIONS: slots.sections ? `\n${indent(slots.sections, 6)}\n` : '',
    });
    writeFileSync(join(dir, 'index.html'), page, 'utf-8');
    written += 1;
  }
}

function renderLayer2(): void {
  const template = readFileSync(
    join(LAYER2_DIR, '_layer2-shared', 'page.template.html'),
    'utf-8',
  );
  for (const slug of recipeSlugs(LAYER2_DIR)) {
    const dir = join(LAYER2_DIR, slug);
    const slots = readSlots(join(dir, 'page.en.html'));
    const entry = bySlug.get(slug);
    const page = fill(template, {
      TITLE: slots.title ?? '',
      H1: slots.h1 ?? '',
      LEDE: indent(slots.lede ?? '', 8),
      REPRODUCE_META: indent(slots['reproduce-meta'] ?? '', 8),
      SLUG: slug === '_template' ? '{{SLUG}}' : slug,
      PROJECT: entry ? entry.project : '{{PROJECT}}',
      ISSUE: entry ? String(entry.issue) : '{{ISSUE}}',
      UPSTREAM_URL: slots['upstream-url'] ?? '',
    });
    writeFileSync(join(dir, 'index.html'), page, 'utf-8');
    written += 1;
  }
}

renderLayer1();
renderLayer2();

console.log(`[generate-repro-pages] wrote ${written} reproduction page(s).`);
if (unhighlighted.length > 0) {
  console.warn(
    `[generate-repro-pages] plain source inlined for ${unhighlighted.join(', ')} — run \`mise run repro:build:ts\` to render the highlighted version.`,
  );
}
