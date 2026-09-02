import { defineConfig } from '@rspress/core';
import { setupReproDevMiddleware } from './scripts/repro-dev-middleware';
import {
  DOC_REPO_BASE_URL,
  FAVICONS,
  FOOTER_MESSAGE_HTML,
  GITHUB_REPO_URL,
} from './scripts/site-chrome';
import { NAV_OVERRIDES_CSS, SITE_BASE, SITE_ROOT } from './scripts/site-paths';

// Vivarium docs site configuration.
//
// The site is deployed to a non-root GitHub Pages path
// (https://aletheia-works.github.io/vivarium/), so `base` must match the
// repo name with leading and trailing slashes. If the repo is ever renamed
// or moved to a custom domain, update `base` accordingly.

export default defineConfig({
  root: SITE_ROOT,
  base: SITE_BASE,
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
  globalStyles: NAV_OVERRIDES_CSS,
  markdown: {
    link: {
      checkDeadLinks: true,
    },
  },
  head: [
    // Favicons come from scripts/site-chrome.ts so the reproduction
    // pages' chrome.js, which injects the same icons, cannot drift.
    ...FAVICONS.map((attrs) => ['link', attrs] as [string, typeof attrs]),
    // The font links stay inline: reproduction pages don't use them.
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
        content: GITHUB_REPO_URL,
      },
    ],
    footer: {
      message: FOOTER_MESSAGE_HTML,
    },
    editLink: {
      docRepoBaseUrl: DOC_REPO_BASE_URL,
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
          docRepoBaseUrl: DOC_REPO_BASE_URL,
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
          docRepoBaseUrl: DOC_REPO_BASE_URL,
          text: 'GitHub でこのページを編集',
        },
      },
    ],
  },

  // Dev-only middleware that intercepts
  // `/vivarium/repro/<project>/<issue_path>/...` URLs and serves the
  // corresponding file from `src/layer{1,2,3}_*/<recipe>/` BEFORE
  // rspress's SPA history fallback claims the URL.
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
        setupReproDevMiddleware(server);
      },
    },
  },
});
