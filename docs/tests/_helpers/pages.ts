// Page enumeration helper for the docs E2E suite.
//
// Scans `docs/site/{en,ja}/` at test-load time and emits the URL list
// the smoke and i18n specs iterate over. Listing the pages dynamically
// (rather than hardcoding) means new content under `docs/site/` is
// automatically covered by the smoke suite the next time it runs —
// the "silent regression" that motivated this PR (a feature lands on
// page X, page Y stops rendering, nobody notices) becomes the kind of
// thing CI catches without a separate test added.
//
// The URL projection mirrors rspress's default: file path
// `docs/site/{lang}/foo/bar.mdx` becomes URL
// `/vivarium/[ja/]foo/bar` (`.mdx`/`.md` extensions stripped, `index`
// segments collapsed to a trailing slash, JA pages prefixed with
// `/ja/`).

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Use `import.meta.dirname` (Node 20.11+ / Bun stable) instead of the
// CommonJS `__dirname` global — Playwright loads this file under Node
// in ES-module mode, where `__dirname` is undefined. Bun's `bun test`
// (used by the unit suite) accepts both, but `import.meta.dirname`
// keeps the two test runners on the same code path.
const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DOCS_SITE = path.join(REPO_ROOT, 'docs', 'site');
const SITE_BASE = '/vivarium';

export interface PageRef {
  /** Site-relative URL (begins with `/vivarium`). */
  url: string;
  /** Locale: "en" or "ja". */
  lang: 'en' | 'ja';
  /** Filesystem path relative to docs/site/{lang}/. */
  rel: string;
}

function listPagesIn(lang: 'en' | 'ja'): PageRef[] {
  const root = path.join(DOCS_SITE, lang);
  const out: PageRef[] = [];

  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full, prefix === '' ? entry : `${prefix}/${entry}`);
        continue;
      }
      if (!/\.(md|mdx)$/i.test(entry)) continue;
      const baseName = entry.replace(/\.(md|mdx)$/i, '');
      // `index.md` / `index.mdx` collapses to the directory's URL with
      // a trailing slash (rspress convention).
      const rel = prefix === '' ? entry : `${prefix}/${entry}`;
      const urlSlug =
        baseName === 'index'
          ? prefix === ''
            ? ''
            : `${prefix}/`
          : prefix === ''
            ? baseName
            : `${prefix}/${baseName}`;
      const langPrefix = lang === 'en' ? '' : '/ja';
      const url =
        urlSlug === ''
          ? `${SITE_BASE}${langPrefix}/`
          : `${SITE_BASE}${langPrefix}/${urlSlug}`;
      out.push({ url, lang, rel });
    }
  }

  walk(root, '');
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

const EN_PAGES = listPagesIn('en');
const JA_PAGES = listPagesIn('ja');

export const ALL_PAGES: PageRef[] = [...EN_PAGES, ...JA_PAGES];

// Pages that the i18n switcher case visits. Picked to cover the major
// page shapes (landing, prose, tabular spec, gallery) so a regression
// in any one shape's bilingual surface gets caught.
export const I18N_BELLWETHERS = [
  '/vivarium/',
  '/vivarium/architecture',
  '/vivarium/guide/getting-started',
  '/vivarium/repro/',
  '/vivarium/spec/contract-v1',
];

// EN ↔ JA URL pairing used by the i18n switcher case. Given an EN URL,
// returns the JA URL the locale switcher should land on, and vice
// versa. The spec asserts both directions.
export function partnerUrl(url: string): string {
  if (url.startsWith('/vivarium/ja/')) {
    return url.replace('/vivarium/ja/', '/vivarium/');
  }
  if (url === '/vivarium/ja') {
    return '/vivarium/';
  }
  return url.replace('/vivarium/', '/vivarium/ja/');
}
