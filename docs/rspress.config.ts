import { defineConfig } from '@rspress/core';
import { setupReproDevMiddleware } from './scripts/repro-dev-middleware';
import {
  DOC_REPO_BASE_URL,
  FAVICONS,
  FOOTER_MESSAGE_HTML,
  GITHUB_REPO_URL,
} from './scripts/site-chrome';
import { NAV_OVERRIDES_CSS, SITE_BASE, SITE_ROOT } from './scripts/site-paths';

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
  route: {
    localeRedirect: 'only-default-lang',
  },
  globalStyles: NAV_OVERRIDES_CSS,
  markdown: {
    link: {
      checkDeadLinks: true,
    },
  },
  head: [
    ...FAVICONS.map((attrs) => ['link', attrs] as [string, typeof attrs]),
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

  builderConfig: {
    server: {
      setup({ server }) {
        setupReproDevMiddleware(server);
      },
    },
  },
});
