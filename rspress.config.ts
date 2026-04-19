import path from 'node:path';
import { defineConfig } from '@rspress/core';

// Vivarium docs site configuration.
//
// The site is deployed to a non-root GitHub Pages path
// (https://aletheia-works.github.io/vivarium/), so `base` must match the
// repo name with leading and trailing slashes. If the repo is ever renamed
// or moved to a custom domain, update `base` accordingly.

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  base: '/vivarium/',
  title: 'Vivarium',
  description: 'Universal bug reproduction — any language, any environment, any scale.',
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
    enableContentAnimation: true,
    lastUpdated: true,
  },
});
