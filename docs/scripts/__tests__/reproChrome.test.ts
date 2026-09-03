import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { localeCounterpartPath } from '../../../src/layer1_wasm/_assets/locale.js';
import { buildNavByLocale, renderChromeData } from '../generate-repro-chrome';
import { FAVICONS, FOOTER_MESSAGE_HTML, GITHUB_REPO_URL } from '../site-chrome';
import { SITE_API_DIR, SITE_BASE, SITE_ROOT } from '../site-paths';

const LOCALES = ['en', 'ja'] as const;
const CHROME_DATA_PATH = path.join(
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
}

function readNavJson(lang: 'en' | 'ja'): NavEntry[] {
  const p = path.join(SITE_ROOT, lang, '_nav.json');
  return JSON.parse(readFileSync(p, 'utf-8')) as NavEntry[];
}

describe('repro nav — every link resolves to a real page', () => {
  function resolves(lang: 'en' | 'ja', link: string): boolean {
    const localeRoot = path.join(SITE_ROOT, lang);
    const rel = link.replace(/^\//, '');
    const candidates: string[] = [];
    if (rel === '' || rel.endsWith('/')) {
      const dir = rel.replace(/\/$/, '');
      candidates.push(path.join(localeRoot, dir, 'index.md'));
      candidates.push(path.join(localeRoot, dir, 'index.mdx'));
    } else {
      candidates.push(path.join(localeRoot, `${rel}.md`));
      candidates.push(path.join(localeRoot, `${rel}.mdx`));
      candidates.push(path.join(localeRoot, rel, 'index.md'));
      candidates.push(path.join(localeRoot, rel, 'index.mdx'));
    }
    return candidates.some((c) => existsSync(c));
  }

  for (const lang of LOCALES) {
    test(`docs/site/${lang}/_nav.json has no dead links`, () => {
      const dead = readNavJson(lang)
        .filter((e) => !resolves(lang, e.link))
        .map((e) => `${e.text} -> ${e.link}`);
      expect(dead).toEqual([]);
    });
  }
});

describe('repro nav — generated module matches the source', () => {
  test('chrome-data.js is up to date', () => {
    const expected = renderChromeData(buildNavByLocale());
    const actual = readFileSync(CHROME_DATA_PATH, 'utf-8');
    if (actual !== expected) {
      throw new Error(
        'src/layer1_wasm/_assets/chrome-data.js is stale. Run ' +
          '`mise run recipes:index` and commit the result.',
      );
    }
    expect(actual).toBe(expected);
  });

  for (const lang of LOCALES) {
    test(`${lang} nav labels and order match _nav.json`, () => {
      const nav = buildNavByLocale();
      expect(nav[lang].map((i) => i.text)).toEqual(
        readNavJson(lang).map((e) => e.text),
      );
    });
  }

  test('JA links carry the /ja segment and EN links do not', () => {
    const nav = buildNavByLocale();
    for (const item of nav.en) {
      expect(item.link.startsWith('/vivarium/ja/')).toBe(false);
      expect(item.link.startsWith('/vivarium/')).toBe(true);
    }
    for (const item of nav.ja) {
      expect(item.link.startsWith('/vivarium/ja/')).toBe(true);
    }
  });
});

describe('site chrome — repro pages and rspress agree', () => {
  test('rspress config renders the shared footer message', async () => {
    const config = (await import('../../rspress.config')).default;
    expect(config.themeConfig?.footer?.message).toBe(FOOTER_MESSAGE_HTML);
  });

  test('rspress config renders the shared favicons', async () => {
    const config = (await import('../../rspress.config')).default;
    const heads = (config.head ?? []) as unknown[];
    for (const icon of FAVICONS) {
      const found = heads.some(
        (h) =>
          Array.isArray(h) &&
          h[0] === 'link' &&
          (h[1] as Record<string, string>)?.href === icon.href,
      );
      expect(found).toBe(true);
    }
  });

  test('generated module carries the same values as the config module', () => {
    const rendered = renderChromeData(buildNavByLocale());
    expect(rendered).toContain(JSON.stringify(FOOTER_MESSAGE_HTML));
    expect(rendered).toContain(JSON.stringify(GITHUB_REPO_URL));
    for (const icon of FAVICONS) {
      expect(rendered).toContain(JSON.stringify(icon.href));
    }
  });
});

describe('repro nav — chrome.js consumes the generated module', () => {
  const CHROME_JS = path.join(
    SITE_ROOT,
    '..',
    '..',
    'src',
    'layer1_wasm',
    '_assets',
    'chrome.js',
  );

  test('chrome.js imports NAV_ITEMS rather than hardcoding it', () => {
    const src = readFileSync(CHROME_JS, 'utf-8');
    expect(src).toContain("from './chrome-data.js'");
    expect(src).not.toMatch(/const NAV_ITEMS\s*=\s*\[/);
  });

  test('chrome.js renders a locale switcher with rspress’s attributes', () => {
    const src = readFileSync(CHROME_JS, 'utf-8');
    expect(src).toContain('hreflang=');
    expect(src).toContain('rel="alternate"');
  });

  test('chrome.js derives the switcher target rather than hardcoding it', () => {
    const src = readFileSync(CHROME_JS, 'utf-8');
    expect(src).toContain("from './locale.js'");
    expect(src).toContain('localeCounterpartPath(location.pathname');
  });
});

describe('repro nav — locale switcher points at the same recipe', () => {
  test('EN recipe page maps to its JA sibling', () => {
    expect(
      localeCounterpartPath('/vivarium/repro/pandas/56679/', SITE_BASE),
    ).toBe('/vivarium/ja/repro/pandas/56679/');
  });

  test('JA recipe page maps back to its EN sibling', () => {
    expect(
      localeCounterpartPath('/vivarium/ja/repro/flock/is-advisory/', SITE_BASE),
    ).toBe('/vivarium/repro/flock/is-advisory/');
  });

  test('EN -> JA -> EN round-trips to the original path', () => {
    const en = '/vivarium/repro/cpython/137205/';
    const ja = localeCounterpartPath(en, SITE_BASE);
    expect(ja).not.toBeNull();
    expect(localeCounterpartPath(ja as string, SITE_BASE)).toBe(en);
  });

  test('trailing slash and explicit index.html normalise the same way', () => {
    const want = '/vivarium/ja/repro/numpy/28287/';
    expect(
      localeCounterpartPath('/vivarium/repro/numpy/28287', SITE_BASE),
    ).toBe(want);
    expect(
      localeCounterpartPath(
        '/vivarium/repro/numpy/28287/index.html',
        SITE_BASE,
      ),
    ).toBe(want);
  });

  for (const [label, pathname] of [
    ['shared smoke page', '/vivarium/repro/numpy/_shared/_test/'],
    ['flat shared scaffolding', '/vivarium/repro/_shared/_test/'],
    ['project landing', '/vivarium/repro/pandas/'],
    ['gallery', '/vivarium/repro/'],
    ['site root', '/vivarium/'],
    ['JA site root', '/vivarium/ja/'],
    ['layer static server', '/pandas-56679/'],
    ['recipe asset', '/vivarium/repro/numpy/28287/wheels/manifest.json'],
  ] as const) {
    test(`${label} has no counterpart`, () => {
      expect(localeCounterpartPath(pathname, SITE_BASE)).toBeNull();
    });
  }

  test('every published recipe URL pair agrees with the derivation', () => {
    interface Entry {
      slug: string;
      page_url: string;
      page_url_ja?: string;
    }
    const index = JSON.parse(
      readFileSync(path.join(SITE_API_DIR, 'recipes.json'), 'utf-8'),
    ) as { recipes: Entry[] };

    const translated = index.recipes.filter((r) => r.page_url_ja);
    expect(translated.length).toBeGreaterThan(0);

    const mismatches = translated.flatMap((r) => {
      const en = new URL(r.page_url).pathname;
      const ja = new URL(r.page_url_ja as string).pathname;
      const out: string[] = [];
      const toJa = localeCounterpartPath(en, SITE_BASE);
      if (toJa !== ja) out.push(`${r.slug}: ${en} -> ${toJa}, want ${ja}`);
      const toEn = localeCounterpartPath(ja, SITE_BASE);
      if (toEn !== en) out.push(`${r.slug}: ${ja} -> ${toEn}, want ${en}`);
      return out;
    });
    expect(mismatches).toEqual([]);
  });
});
