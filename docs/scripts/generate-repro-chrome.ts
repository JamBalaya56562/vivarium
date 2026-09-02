#!/usr/bin/env bun
//
// Generate the nav data that the standalone reproduction pages' chrome
// renders, from the docs site's own nav definition.
//
// The problem this solves
// -----------------------
// Reproduction pages under `src/layer{1,2}_*/` do not go through rspress.
// Their header is injected at runtime by
// `src/layer1_wasm/_assets/chrome.js`, which used to carry a hardcoded
// `NAV_ITEMS` array with a comment reading "keep in sync with
// docs/site/_nav.json". That manual sync broke: the array shipped two
// dead links (`Vision` -> /vivarium/vision, `AI workflow` ->
// /vivarium/ai-workflow, neither of which exists) and was missing two
// live ones (Overview, Guide).
//
// Now `docs/site/{en,ja}/_nav.json` — which rspress already consumes as
// the docs nav — is the single source, and this script projects it into
// a small ES module that chrome.js imports.
//
// Why a build-time module and not a runtime fetch
// -----------------------------------------------
// chrome.js paints the page header before anything else; making it await
// a JSON fetch would put a network round-trip in front of first paint.
// A static ES import next to chrome.js costs nothing extra — it is
// resolved by the same module graph that already loads chrome.js.
//
// Why the output is tracked, not gitignored
// -----------------------------------------
// `mise run ci:repro` runs the Layer 1 Playwright suite without ever
// invoking `docs`' `generate` chain. If `chrome-data.js` were a
// gitignored artefact, a fresh checkout would fail to resolve the import
// and every reproduction page's module graph would break. Tracking
// generated output is also this repo's existing convention — see
// `docs/site/public/api/recipes.json`, tracked deliberately so recipe
// PRs show the index diff. Drift is prevented instead by
// `docs/scripts/__tests__/reproChrome.test.ts`, which re-derives the file
// and asserts byte-equality.
//
// Dead-link guard
// ---------------
// Every nav link is resolved against the docs content tree, and an
// unresolvable one fails this script — which means it fails
// `bun run generate`, and therefore `bun run build` and
// `mise run recipes:index` too. rspress's own `markdown.link.checkDeadLinks`
// only inspects links inside markdown, so nav entries were never covered.
//
// Wiring: `docs/package.json` `generate` chain.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAVICONS, FOOTER_MESSAGE_HTML, GITHUB_REPO_URL } from './site-chrome';
import { SITE_BASE, SITE_ROOT } from './site-paths';

const LOCALES = ['en', 'ja'] as const;
type Locale = (typeof LOCALES)[number];

const OUT_PATH = join(
  SITE_ROOT,
  '..',
  '..',
  'src',
  'layer1_wasm',
  '_assets',
  'chrome-data.js',
);

interface NavEntry {
  text: string;
  link: string;
  activeMatch?: string;
}

interface ChromeNavItem {
  text: string;
  link: string;
}

/** `/vivarium/` -> `/vivarium` (no trailing slash, so links concatenate). */
const BASE = SITE_BASE.replace(/\/$/, '');

/**
 * Absolute site path for a locale-relative `_nav.json` link. rspress
 * prepends the base and the locale segment itself; repro pages are plain
 * HTML with no router, so they need the finished path.
 */
function absoluteLink(lang: Locale, link: string): string {
  const localePrefix = lang === 'en' ? BASE : `${BASE}/ja`;
  return `${localePrefix}${link}`;
}

/**
 * Resolve a locale-relative nav link to a content file under
 * `docs/site/<lang>/`, mirroring rspress's own routing:
 *   `/x/`   -> x/index.md(x)
 *   `/x/y`  -> x/y.md(x), else x/y/index.md(x)
 *   `/x`    -> x.md(x),   else x/index.md(x)
 * Returns the matched path, or null when the link is dead.
 */
function resolveNavLink(lang: Locale, link: string): string | null {
  const localeRoot = join(SITE_ROOT, lang);
  const rel = link.replace(/^\//, '');
  const candidates: string[] = [];
  if (rel === '' || rel.endsWith('/')) {
    const dir = rel.replace(/\/$/, '');
    candidates.push(join(localeRoot, dir, 'index.md'));
    candidates.push(join(localeRoot, dir, 'index.mdx'));
  } else {
    candidates.push(join(localeRoot, `${rel}.md`));
    candidates.push(join(localeRoot, `${rel}.mdx`));
    candidates.push(join(localeRoot, rel, 'index.md'));
    candidates.push(join(localeRoot, rel, 'index.mdx'));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function readNav(lang: Locale): NavEntry[] {
  const navPath = join(SITE_ROOT, lang, '_nav.json');
  if (!existsSync(navPath)) {
    console.error(`ERROR: ${navPath} not found.`);
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(navPath, 'utf-8'));
  if (!Array.isArray(parsed)) {
    console.error(`ERROR: ${navPath} must contain a JSON array.`);
    process.exit(1);
  }
  return parsed as NavEntry[];
}

/**
 * Render the module. Biome does not lint `src/`, so this function is the
 * formatter of record and the byte-equality test depends on it being
 * deterministic. String literals go through `JSON.stringify` — hence
 * double quotes rather than chrome.js's single quotes — because it is
 * the escaping that cannot be got wrong by a nav label containing a
 * quote, a backslash, or (as the JA nav does) non-ASCII text.
 */
export function renderChromeData(
  navByLocale: Record<Locale, ChromeNavItem[]>,
): string {
  const lines: string[] = [
    '// AUTO-GENERATED by docs/scripts/generate-repro-chrome.ts.',
    '// Source of truth: docs/site/{en,ja}/_nav.json.',
    '// Do not edit by hand — run `mise run recipes:index` and commit.',
    '',
    'export const NAV_ITEMS = {',
  ];
  for (const lang of LOCALES) {
    lines.push(`  ${lang}: [`);
    for (const item of navByLocale[lang]) {
      lines.push(
        `    { text: ${JSON.stringify(item.text)}, link: ${JSON.stringify(item.link)} },`,
      );
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  lines.push(`export const SITE_BASE = ${JSON.stringify(SITE_BASE)};`);
  lines.push('');
  lines.push(`export const GH_REPO = ${JSON.stringify(GITHUB_REPO_URL)};`);
  lines.push('');
  lines.push(
    `export const FOOTER_MESSAGE_HTML = ${JSON.stringify(FOOTER_MESSAGE_HTML)};`,
  );
  lines.push('');
  lines.push('export const FAVICONS = [');
  for (const icon of FAVICONS) {
    lines.push(`  ${JSON.stringify(icon)},`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the nav tables, failing on any dead link. Exported so the unit
 * test can re-derive the same data without shelling out.
 */
export function buildNavByLocale(): Record<Locale, ChromeNavItem[]> {
  const out = {} as Record<Locale, ChromeNavItem[]>;
  const dead: string[] = [];
  for (const lang of LOCALES) {
    const entries = readNav(lang);
    out[lang] = entries.map((entry, i) => {
      if (resolveNavLink(lang, entry.link) === null) {
        dead.push(
          `docs/site/${lang}/_nav.json[${i}] ${JSON.stringify(entry.text)} -> ` +
            `${entry.link}: no matching page under docs/site/${lang}/`,
        );
      }
      return { text: entry.text, link: absoluteLink(lang, entry.link) };
    });
  }
  if (dead.length > 0) {
    console.error(
      'ERROR: nav entries point at pages that do not exist:\n  ' +
        `${dead.join('\n  ')}\n` +
        'Add the page, fix the link, or remove the entry.',
    );
    process.exit(1);
  }
  return out;
}

if (import.meta.main) {
  const nav = buildNavByLocale();
  const rendered = renderChromeData(nav);
  const previous = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf-8') : '';
  if (previous !== rendered) {
    writeFileSync(OUT_PATH, rendered, 'utf-8');
    console.error(`Wrote ${OUT_PATH}`);
  } else {
    console.error(`${OUT_PATH} already up to date.`);
  }
}
