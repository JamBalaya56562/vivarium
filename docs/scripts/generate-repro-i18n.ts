#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HTMLElement, NodeType, parse } from 'node-html-parser';
import { REPO_ROOT, SITE_API_DIR } from './site-paths';

const LAYER_DIRS = ['layer1_wasm', 'layer2_docker'] as const;

const ALLOWED_TAGS = new Set([
  'code',
  'em',
  'strong',
  'br',
  'kbd',
  'abbr',
  'span',
]);

interface RecipeIndexEntry {
  slug: string;
  layer: number;
  page_url: string;
}

interface TranslationFile {
  schema_version?: number;
  lang?: string;
  slug?: string;
  strings?: Record<string, string>;
}

const problems: string[] = [];

function fail(where: string, message: string): void {
  problems.push(`${where}: ${message}`);
}

function pagePath(pageUrl: string): string {
  return new URL(pageUrl).pathname;
}

function jaPagePath(enPath: string): string {
  return enPath.replace(/^(\/[^/]+)\//, '$1/ja/');
}

function checkValue(
  where: string,
  key: string,
  value: string,
  hostTag: string,
): void {
  const tagRe = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m: RegExpExecArray | null = tagRe.exec(value);
  while (m !== null) {
    const tag = (m[1] ?? '').toLowerCase();
    const attrs = (m[2] ?? '').replace(/\/\s*$/, '').trim();
    if (hostTag === 'title') {
      fail(where, `key "${key}" is a <title>; it must be plain text`);
    } else if (!ALLOWED_TAGS.has(tag)) {
      fail(where, `key "${key}" uses disallowed tag <${tag}>`);
    }
    if (attrs.length > 0) {
      fail(where, `key "${key}" has attributes on <${tag}> (${attrs})`);
    }
    m = tagRe.exec(value);
  }
}

function fillSlots(
  where: string,
  key: string,
  value: string,
  slots: string[],
): string {
  return value.replace(/\{(\d+)\}/g, (whole, digits: string) => {
    const idx = Number(digits);
    const slot = slots[idx];
    if (slot === undefined) {
      fail(
        where,
        `key "${key}" references slot ${whole} but the source element has ` +
          `${slots.length} child element(s)`,
      );
      return '';
    }
    return slot;
  });
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

function applySplices(
  source: string,
  splices: Splice[],
  onOverlap: (a: Splice, b: Splice) => void,
): string {
  const ordered = [...splices].sort((a, b) => b.start - a.start);
  for (let i = 1; i < ordered.length; i += 1) {
    const later = ordered[i - 1];
    const earlier = ordered[i];
    if (later && earlier && earlier.end > later.start) {
      onOverlap(earlier, later);
    }
  }
  let out = source;
  for (const s of ordered) {
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return out;
}

function innerRange(
  source: string,
  el: HTMLElement,
): { start: number; end: number } | null {
  const [start, end] = el.range;
  const openEnd = source.indexOf('>', start);
  if (openEnd < 0 || openEnd >= end) return null;
  const closeTag = `</${el.rawTagName}`;
  const closeStart = source.lastIndexOf(closeTag, end);
  if (closeStart <= openEnd) return null;
  return { start: openEnd + 1, end: closeStart };
}

function translateRecipe(
  recipeDir: string,
  label: string,
  entry: RecipeIndexEntry,
): string | null {
  const htmlPath = join(recipeDir, 'index.html');
  const source = readFileSync(htmlPath, 'utf-8');
  const jsonPath = join(recipeDir, 'i18n.ja.json');
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8')) as TranslationFile;

  if (parsed.schema_version !== 1) {
    fail(label, 'i18n.ja.json: schema_version must be 1');
  }
  if (parsed.lang !== 'ja') {
    fail(label, 'i18n.ja.json: lang must be "ja"');
  }
  if (parsed.slug !== entry.slug) {
    fail(
      label,
      `i18n.ja.json: slug is ${JSON.stringify(parsed.slug)}, expected ` +
        `${JSON.stringify(entry.slug)}`,
    );
  }
  const strings = parsed.strings ?? {};

  const root = parse(source, {
    comment: true,
    voidTag: { closingSlash: true },
  });

  const splices: Splice[] = [];
  const usedKeys = new Set<string>();
  const seenKeys = new Set<string>();

  const enPath = pagePath(entry.page_url);
  const jaPath = jaPagePath(enPath);

  function rewriteHrefInOpenTag(openTag: string): string {
    return openTag.replace(/(\shref=")([^"]*)(")/, (whole, pre, href, post) => {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('#')) {
        return whole;
      }
      const u = new URL(href, `https://x${jaPath}`);
      return `${pre}${u.pathname}${u.search}${u.hash}${post}`;
    });
  }

  const annotated = root.querySelectorAll('[data-i18n]');

  function hasAnnotatedAncestor(el: HTMLElement): boolean {
    let p = el.parentNode as HTMLElement | null;
    while (p) {
      if (typeof p.getAttribute === 'function' && p.getAttribute('data-i18n')) {
        return true;
      }
      p = p.parentNode as HTMLElement | null;
    }
    return false;
  }

  function renderTranslated(el: HTMLElement): string {
    const key = el.getAttribute('data-i18n');
    const openEnd = el.outerHTML.indexOf('>') + 1;
    const openTag = rewriteHrefInOpenTag(el.outerHTML.slice(0, openEnd));
    const closeTag = `</${el.rawTagName}>`;
    if (!key) return openTag + el.innerHTML + closeTag;
    const value = strings[key];
    if (value === undefined) {
      fail(label, `data-i18n="${key}" has no entry in i18n.ja.json`);
      return el.outerHTML;
    }
    usedKeys.add(key);
    checkValue(label, key, value, el.rawTagName.toLowerCase());
    const slots = el.childNodes
      .filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE)
      .map((n) => renderTranslated(n));
    return openTag + fillSlots(label, key, value, slots) + closeTag;
  }

  for (const el of annotated) {
    const key = el.getAttribute('data-i18n') ?? '';
    if (seenKeys.has(key)) {
      fail(label, `duplicate data-i18n key "${key}"`);
    }
    seenKeys.add(key);
    if (hasAnnotatedAncestor(el)) continue;

    const value = strings[key];
    if (value === undefined) {
      fail(label, `data-i18n="${key}" has no entry in i18n.ja.json`);
      continue;
    }
    usedKeys.add(key);
    checkValue(label, key, value, el.rawTagName.toLowerCase());
    const slots = el.childNodes
      .filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE)
      .map((n) => renderTranslated(n));
    const filled = fillSlots(label, key, value, slots);
    const range = innerRange(source, el);
    if (range === null) {
      fail(label, `could not locate inner range for data-i18n="${key}"`);
      continue;
    }
    splices.push({ ...range, text: filled });
  }

  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    const spec = el.getAttribute('data-i18n-attr') ?? '';
    for (const pair of spec.split(';')) {
      const trimmed = pair.trim();
      if (trimmed === '') continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) {
        fail(label, `malformed data-i18n-attr segment "${trimmed}"`);
        continue;
      }
      const attr = trimmed.slice(0, eq).trim();
      const key = trimmed.slice(eq + 1).trim();
      const value = strings[key];
      if (value === undefined) {
        fail(label, `data-i18n-attr key "${key}" has no entry in i18n.ja.json`);
        continue;
      }
      usedKeys.add(key);
      checkValue(label, key, value);
      const current = el.getAttribute(attr);
      if (current === undefined) {
        fail(label, `data-i18n-attr names ${attr}, absent on the element`);
        continue;
      }
      const [elStart] = el.range;
      const openTag = el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1);
      const attrRe = new RegExp(`(${attr}=")([^"]*)(")`);
      const found = attrRe.exec(openTag);
      if (found === null) {
        fail(label, `could not locate ${attr}="..." to translate`);
        continue;
      }
      const valueStart = elStart + found.index + (found[1]?.length ?? 0);
      splices.push({
        start: valueStart,
        end: valueStart + (found[2]?.length ?? 0),
        text: value.replace(/"/g, '&quot;'),
      });
    }
  }

  for (const key of Object.keys(strings)) {
    if (!usedKeys.has(key)) {
      fail(label, `i18n.ja.json key "${key}" has no data-i18n in index.html`);
    }
  }

  const htmlEl = root.querySelector('html');
  if (htmlEl) {
    const [s] = htmlEl.range;
    const openTag = htmlEl.outerHTML.slice(
      0,
      htmlEl.outerHTML.indexOf('>') + 1,
    );
    const langRe = /(lang=")([^"]*)(")/;
    const found = langRe.exec(openTag);
    if (found !== null) {
      const valueStart = s + found.index + (found[1]?.length ?? 0);
      splices.push({
        start: valueStart,
        end: valueStart + (found[2]?.length ?? 0),
        text: 'ja',
      });
    } else {
      fail(label, '<html> has no lang attribute to switch');
    }
  }

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('#')) {
      continue;
    }
    if (hasAnnotatedAncestor(a)) continue;
    const resolved = new URL(href, `https://x${jaPath}`);
    const [aStart] = a.range;
    const openTag = a.outerHTML.slice(0, a.outerHTML.indexOf('>') + 1);
    const found = /(href=")([^"]*)(")/.exec(openTag);
    if (found === null) continue;
    const valueStart = aStart + found.index + (found[1]?.length ?? 0);
    splices.push({
      start: valueStart,
      end: valueStart + (found[2]?.length ?? 0),
      text: resolved.pathname + resolved.search + resolved.hash,
    });
  }

  const headEl = root.querySelector('head');
  if (headEl === null) {
    fail(label, 'no <head> element to anchor <base> to');
  } else {
    const [headStart] = headEl.range;
    const openEnd = headStart + headEl.outerHTML.indexOf('>') + 1;
    splices.push({
      start: openEnd,
      end: openEnd,
      text:
        '\n    <!-- Assets resolve into the English tree; this page is ' +
        'the JA rendering of the same recipe. -->\n' +
        `    <base href="${enPath}" />`,
    });
  }

  const out = applySplices(source, splices, (a, b) => {
    fail(
      label,
      `overlapping replacements at [${a.start},${a.end}) and ` +
        `[${b.start},${b.end}); a nested data-i18n is being spliced twice`,
    );
  });
  if (problems.length > 0) return null;
  return out;
}

function loadRecipeIndex(): Map<string, RecipeIndexEntry> {
  const p = join(SITE_API_DIR, 'recipes.json');
  const parsed = JSON.parse(readFileSync(p, 'utf-8')) as {
    recipes: RecipeIndexEntry[];
  };
  return new Map(parsed.recipes.map((r) => [r.slug, r]));
}

function main(): void {
  const index = loadRecipeIndex();
  let written = 0;
  let skipped = 0;
  void skipped;

  for (const layerDir of LAYER_DIRS) {
    const root = join(REPO_ROOT, 'src', layerDir);
    if (!existsSync(root)) continue;
    for (const slug of readdirSync(root).sort()) {
      if (slug.startsWith('_') || slug.startsWith('.')) continue;
      const recipeDir = join(root, slug);
      if (!existsSync(join(recipeDir, 'index.html'))) continue;

      const entry = index.get(slug);
      if (entry === undefined) {
        console.error(
          `ERROR: ${slug} has an index.html but no entry in recipes.json. ` +
            'Run `mise run recipes:index` first.',
        );
        process.exit(1);
      }

      if (!existsSync(join(recipeDir, 'i18n.ja.json'))) {
        fail(
          `src/${layerDir}/${slug}`,
          'no i18n.ja.json. Every reproduction page ships EN + JA in the ' +
            'same PR; copy the keys out of index.html and translate them.',
        );
        skipped += 1;
        continue;
      }

      const label = `src/${layerDir}/${slug}`;
      const out = translateRecipe(recipeDir, label, entry);
      if (out === null) continue;
      const outPath = join(recipeDir, 'index.ja.html');
      const previous = existsSync(outPath)
        ? readFileSync(outPath, 'utf-8')
        : '';
      if (previous !== out) writeFileSync(outPath, out, 'utf-8');
      written += 1;
    }
  }

  if (problems.length > 0) {
    console.error(
      `ERROR: ${problems.length} translation problem(s):\n  ` +
        problems.join('\n  '),
    );
    process.exit(1);
  }

  console.error(`Wrote ${written} Japanese reproduction page(s).`);
}

if (import.meta.main) main();

export { jaPagePath, pagePath, translateRecipe };
