import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@rspress/core';

// Vivarium docs site configuration.
//
// The site is deployed to a non-root GitHub Pages path
// (https://aletheia-works.github.io/vivarium/), so `base` must match the
// repo name with leading and trailing slashes. If the repo is ever renamed
// or moved to a custom domain, update `base` accordingly.

const REPO_ROOT = path.join(__dirname, '..');
const REPRO_ROOTS = [
  path.join(REPO_ROOT, 'src', 'layer1_wasm'),
  path.join(REPO_ROOT, 'src', 'layer2_docker'),
  path.join(REPO_ROOT, 'src', 'layer3_thirdway'),
];

const REPRO_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve a `/repro/<sub>` URL path to an absolute file under one of
 * `src/layer{1,2,3}_*`. Supports trailing-slash → index.html and
 * extension-based MIME type. Returns null if no match.
 */
function resolveReproFile(subpath: string): string | null {
  if (!subpath) subpath = '';
  let lookup = subpath;
  if (lookup === '' || lookup.endsWith('/')) lookup += 'index.html';

  for (const root of REPRO_ROOTS) {
    const candidate = path.join(root, lookup);
    if (!existsSync(candidate)) continue;
    const s = statSync(candidate);
    if (s.isDirectory()) {
      const idx = path.join(candidate, 'index.html');
      if (existsSync(idx)) return idx;
      continue;
    }
    return candidate;
  }
  return null;
}

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  base: '/vivarium/',
  title: 'Vivarium',
  description:
    'Universal bug reproduction — any language, any environment, any scale.',
  lang: 'en',
  locales: [
    {
      lang: 'en',
      label: 'English',
      description:
        'Universal bug reproduction — any language, any environment, any scale.',
    },
    {
      lang: 'ja',
      label: '日本語',
      title: 'Vivarium',
      description: 'あらゆる言語・環境・スケールに対応するバグ再現基盤。',
    },
  ],
  // Lower the breakpoint at which the nav's GitHub icon + theme toggle
  // collapse into the hamburger menu, so the docs nav matches the
  // reproduction-page nav (which keeps both icons inline at all widths).
  globalStyles: path.join(__dirname, 'styles/nav-overrides.css'),
  markdown: {
    link: {
      checkDeadLinks: true,
    },
  },
  head: [
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
    ],
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: '',
      },
    ],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap',
      },
    ],
  ],
  themeConfig: {
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/aletheia-works/vivarium',
      },
    ],
    footer: {
      message:
        'Apache License 2.0 · part of <a href="https://github.com/aletheia-works">aletheia-works</a>',
    },
    editLink: {
      docRepoBaseUrl:
        'https://github.com/aletheia-works/vivarium/tree/main/docs/docs',
    },
    enableContentAnimation: true,
    lastUpdated: true,
    locales: [
      {
        lang: 'en',
        label: 'English',
        outlineTitle: 'On this page',
        prevPageText: 'Previous page',
        nextPageText: 'Next page',
        lastUpdatedText: 'Last updated',
        searchPlaceholderText: 'Search',
        editLink: {
          docRepoBaseUrl:
            'https://github.com/aletheia-works/vivarium/tree/main/docs/docs',
          text: 'Edit this page on GitHub',
        },
      },
      {
        lang: 'ja',
        label: '日本語',
        outlineTitle: 'このページの内容',
        prevPageText: '前のページ',
        nextPageText: '次のページ',
        lastUpdatedText: '最終更新',
        searchPlaceholderText: '検索',
        editLink: {
          docRepoBaseUrl:
            'https://github.com/aletheia-works/vivarium/tree/main/docs/docs',
          text: 'GitHub でこのページを編集',
        },
      },
    ],
  },

  // Dev-only middleware that intercepts `/vivarium/repro/<slug>/...` URLs
  // and serves the corresponding file from `src/layer{1,2,3}_*/<slug>/`
  // BEFORE rspress's SPA history fallback claims the URL.
  //
  // Production deploy doesn't need this — the GH Actions build copies
  // these directories into doc_build/repro/ as plain static assets, so
  // the deployed Pages server resolves them naturally.
  //
  // The `prebuild-repro` package script compiles `repro.ts` → `repro.js`
  // before this middleware starts serving, so the in-page Pyodide /
  // Ruby.wasm / php-wasm runtime can actually execute.
  builderConfig: {
    dev: {
      setupMiddlewares: [
        (middlewares) => {
          middlewares.unshift((req, res, next) => {
            const url = req.url ?? '';
            const match = url.match(/^\/vivarium\/repro\/([^?#]*)(?:[?#].*)?$/);
            if (!match) return next();
            const subpath = match[1] ?? '';
            const filePath = resolveReproFile(subpath);
            if (!filePath) {
              // No file on disk. Three cases:
              //
              // 1. Directory-shaped URL (empty subpath or ends with '/') —
              //    `/vivarium/repro/`, `/vivarium/repro/some-slug/`. These
              //    should fall through to rspress's SPA so the gallery
              //    page (docs/docs/{en,ja}/repro/index.mdx) can render.
              //    Only the individual recipe slugs that DO have an
              //    index.html in src/ get intercepted above.
              //
              // 2. Extension-less URL — `/vivarium/repro/compare`,
              //    `/vivarium/repro/some-slug`. These are rspress SPA
              //    routes (e.g. R.3's compare.mdx page) or directory URLs
              //    that need a redirect. Fall through so rspress can
              //    handle them.
              //
              // 3. Asset-shaped URL (has an extension) — `repro.wasm`,
              //    `verdict.json`, `repro.js`. These must NOT fall
              //    through, otherwise the SPA returns its HTML shell and
              //    the page tries to parse it as wasm/JSON. Return 404
              //    explicitly with a hint.
              if (subpath === '' || subpath.endsWith('/')) {
                return next();
              }
              if (!path.extname(subpath)) {
                return next();
              }
              res.statusCode = 404;
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.end(
                `404: ${subpath} not found in src/layer{1,2,3}_*/.\n` +
                  'For Rust reproductions: run `cargo build --release --target wasm32-wasip1` in the recipe directory.\n' +
                  'For Layer 2 verdict.json: the file is generated by CI; not present in local dev.\n',
              );
              return;
            }

            const ext = path.extname(filePath).toLowerCase();
            res.setHeader(
              'Content-Type',
              REPRO_MIME[ext] ?? 'application/octet-stream',
            );
            res.setHeader('Cache-Control', 'no-store');
            // The shared service worker (`_shared/sw.js`) is located inside
            // the `_shared/` subtree, but it needs to control the whole
            // `/vivarium/repro/` tree so any reproduction page benefits
            // from the cached Pyodide / Ruby.wasm runtime. Browsers cap
            // a SW's scope to its own directory unless the response sets
            // this header.
            if (filePath.endsWith('sw.js')) {
              res.setHeader(
                'Service-Worker-Allowed',
                '/vivarium/repro/',
              );
            }
            createReadStream(filePath).pipe(res);
          });
        },
      ],
    },
  },
});
