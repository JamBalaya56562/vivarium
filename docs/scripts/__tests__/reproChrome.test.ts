// Unit tests for the reproduction-page nav generator in
// `docs/scripts/generate-repro-chrome.ts`.
//
// Three distinct failures are guarded here.
//
// 1. Dead nav links. The reproduction pages' header used to carry a
//    hardcoded copy of the docs nav, and it drifted: `Vision` ->
//    /vivarium/vision and `AI workflow` -> /vivarium/ai-workflow both
//    shipped to production pointing at pages that do not exist, while
//    Overview and Guide were missing entirely. rspress's
//    `markdown.link.checkDeadLinks` only inspects links written inside
//    markdown, so nav entries had no coverage at all.
//
// 2. Stale generated output. `src/layer1_wasm/_assets/chrome-data.js` is
//    generated but tracked (see the generator's header for why). Tracking
//    it means someone can edit `_nav.json` and commit without
//    regenerating. Re-deriving the file here and asserting byte-equality
//    turns that into a test failure with the exact command to fix it.
//
// 3. A locale switcher that goes to the wrong place. The switcher's
//    href was `${SITE_BASE}ja/` no matter which recipe the visitor was
//    on, so pressing it landed them on the docs top page instead of the
//    Japanese rendering of the page they were reading. The original
//    assertions checked the anchor's `hreflang` / `rel` attributes and
//    passed the whole time — the destination had no coverage at all.
//
// Runs via `bun test scripts/__tests__` (docs `test:unit`).

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
// The browser module under test. Plain JS with no DOM access at module
// scope, which is exactly why it lives next to chrome.js rather than
// inside it.
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
  // `buildNavByLocale` calls process.exit(1) on a dead link, which would
  // abort the whole test run rather than fail one case. So resolve
  // independently here, using the same rules, and assert the list of
  // unresolvable entries is empty — that reports *which* link is dead.
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
  // The footer line, the favicon set and the GitHub URL are rendered
  // twice: once by rspress (themeConfig / head[]) and once by chrome.js
  // on reproduction pages. Both now read docs/scripts/site-chrome.ts.
  // These cases assert the config really consumes it, so a future edit
  // that re-inlines a literal into rspress.config.ts is caught.
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
    // The literal array that drifted must not come back.
    expect(src).not.toMatch(/const NAV_ITEMS\s*=\s*\[/);
  });

  test('chrome.js renders a locale switcher with rspress’s attributes', () => {
    // `docs/tests/i18n.spec.ts` locates the docs-side switcher via
    // `a[hreflang="ja"]`; the repro chrome must expose the same contract
    // so one selector covers both surfaces.
    const src = readFileSync(CHROME_JS, 'utf-8');
    expect(src).toContain('hreflang=');
    expect(src).toContain('rel="alternate"');
  });

  test('chrome.js derives the switcher target rather than hardcoding it', () => {
    // The regression this file now guards: the switcher's href was
    // `${SITE_BASE}ja/` regardless of which recipe you were on, so
    // pressing it took the visitor to the docs top page. The attribute
    // assertions above passed throughout — only the destination was
    // wrong — so the destination gets its own coverage below.
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
    // `_shared/_test/` loads the same chrome but ships no translation.
    ['shared smoke page', '/vivarium/repro/numpy/_shared/_test/'],
    ['flat shared scaffolding', '/vivarium/repro/_shared/_test/'],
    // rspress renders these and brings its own switcher.
    ['project landing', '/vivarium/repro/pandas/'],
    ['gallery', '/vivarium/repro/'],
    ['site root', '/vivarium/'],
    ['JA site root', '/vivarium/ja/'],
    // The Layer 1 / Layer 2 Playwright servers serve recipes at the
    // filesystem root, outside SITE_BASE entirely.
    ['layer static server', '/pandas-56679/'],
    // Assets under a recipe are not pages.
    ['recipe asset', '/vivarium/repro/numpy/28287/wheels/manifest.json'],
  ] as const) {
    test(`${label} has no counterpart`, () => {
      expect(localeCounterpartPath(pathname, SITE_BASE)).toBeNull();
    });
  }

  test('every published recipe URL pair agrees with the derivation', () => {
    // The contract case: recipes.json is what the docs gallery, the MCP
    // server and external consumers navigate by. Deriving one side from
    // the other here means a new recipe is covered the moment it lands,
    // without anyone remembering to extend this file.
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
