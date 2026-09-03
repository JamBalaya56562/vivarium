import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DOCS_SITE = path.join(REPO_ROOT, 'docs', 'site');
const SITE_BASE = '/vivarium';

export interface PageRef {
  url: string;
  lang: 'en' | 'ja';
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

export const I18N_BELLWETHERS = [
  '/vivarium/',
  '/vivarium/architecture',
  '/vivarium/guide/getting-started',
  '/vivarium/repro/',
  '/vivarium/spec/contract-v1',
];

export function partnerUrl(url: string): string {
  if (url.startsWith('/vivarium/ja/')) {
    return url.replace('/vivarium/ja/', '/vivarium/');
  }
  if (url === '/vivarium/ja') {
    return '/vivarium/';
  }
  return url.replace('/vivarium/', '/vivarium/ja/');
}
