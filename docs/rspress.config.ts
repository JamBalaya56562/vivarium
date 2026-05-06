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

// Resolve a /repro/<sub> URL path to an absolute file under one of
// src/layer{1,2,3}_*. Supports trailing-slash to index.html and
// extension-based MIME type. Returns null if no match.
//
// URL to disk-slug mapping for the <project>/<issue_path>/... URL shape:
//
//   1. Underscore-prefixed first segment (e.g. _shared/sw.js,
//      _layer2-shared/...) is looked up as-is, since shared scaffolding
//      lives flat under each src/layer{N}_*/ and never had project /
//      issue segmentation.
//
//   2. Single-segment lookups (e.g. just compare, no recipe assets) are
//      tried as-is so unaffected static files keep resolving.
//
//   3. Multi-segment lookups: first segment is the project, second
//      segment is the issue_path. The recipe directory on disk is one of:
//        a. <project>-<issue_path> (the prefix-style slug, the common
//           case, e.g. cpython-137205, bash-local-shadows-exit).
//        b. <issue_path> (the override-style slug for recipes whose
//           on-disk name does not embed the project, e.g.
//           PROJECT_OVERRIDES['lost-update'] = 'pthread', served at
//           /repro/pthread/lost-update/ from the disk dir lost-update/).
//      Both candidates are tried; the first that exists wins. Any
//      remaining segments are joined back onto the resolved disk slug as
//      the asset path under that recipe directory (e.g. repro.wasm,
//      verdict.json).
function resolveReproFile(rawSubpath: string): string | null {
  const subpath = rawSubpath || '';

  // Trailing-slash directory URL → index.html lookup.
  let trailingFile = '';
  let lookupPath = subpath;
  if (lookupPath === '' || lookupPath.endsWith('/')) {
    trailingFile = 'index.html';
    if (lookupPath.endsWith('/')) lookupPath = lookupPath.slice(0, -1);
  }

  const segments = lookupPath === '' ? [] : lookupPath.split('/');

  // Build the list of candidate disk-relative paths to try, in order.
  const candidates: string[] = [];
  if (segments.length === 0) {
    // Bare `/repro/` — fall through (no candidate).
  } else if (segments[0]?.startsWith('_')) {
    // Shared scaffolding — keep flat lookup.
    candidates.push(joinDisk(segments, trailingFile));
  } else if (segments.length === 1) {
    // Single segment — could be a project landing (no on-disk match) or a
    // legacy flat asset. Try as-is; if it doesn't exist on disk, the
    // caller falls through to rspress.
    candidates.push(joinDisk(segments, trailingFile));
  } else {
    // Multi-segment — try the prefix-style slug first, then the
    // override-style slug.
    const project = segments[0]!;
    const issuePath = segments[1]!;
    const rest = segments.slice(2);
    const prefixSlug = `${project}-${issuePath}`;
    candidates.push(joinDisk([prefixSlug, ...rest], trailingFile));
    const overrideSlug = issuePath;
    candidates.push(joinDisk([overrideSlug, ...rest], trailingFile));
  }

  for (const candidate of candidates) {
    for (const root of REPRO_ROOTS) {
      const abs = path.join(root, candidate);
      if (!existsSync(abs)) continue;
      const s = statSync(abs);
      if (s.isDirectory()) {
        const idx = path.join(abs, 'index.html');
        if (existsSync(idx)) return idx;
        continue;
      }
      return abs;
    }
  }
  return null;
}

function joinDisk(segments: string[], trailingFile: string): string {
  const base = segments.join('/');
  if (!trailingFile) return base;
  return base ? `${base}/${trailingFile}` : trailingFile;
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
    server: {
      setup({ server }) {
        // Dev-only — preview/build don't enter this branch (rsbuild calls
        // setup() in both modes, but in production `doc_build/repro/` is
        // already populated by the deploy workflow, so the catch-all
        // matches no live requests).
        if (server == null) return;
        server.middlewares.use((req, res, next) => {
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
            res.setHeader('Service-Worker-Allowed', '/vivarium/repro/');
          }
          createReadStream(filePath).pipe(res);
        });
      },
    },
  },
});
