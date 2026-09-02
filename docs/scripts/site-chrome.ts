// Site chrome constants shared by the two surfaces that render it.
//
// The docs site (rspress, `docs/rspress.config.ts`) and the standalone
// reproduction pages (`src/layer1_wasm/_assets/chrome.js`, fed by
// `generate-repro-chrome.ts`) both paint the same favicons, the same
// footer line, and the same GitHub links. Until now each held its own
// copy, kept in agreement by hand — the same arrangement that let the
// nav drift into shipping two dead links.
//
// Sibling of `site-paths.ts`, which `rspress.config.ts` already imports.

import { SITE_BASE } from './site-paths';

export const GITHUB_ORG_URL = 'https://github.com/aletheia-works';
export const GITHUB_REPO_URL = `${GITHUB_ORG_URL}/vivarium`;
export const DOC_REPO_BASE_URL = `${GITHUB_REPO_URL}/tree/main/docs/site`;

/**
 * The site-wide footer line.
 *
 * Canonical form is rspress's — `themeConfig.footer.message` renders this
 * string as-is. chrome.js adds `target="_blank" rel="noreferrer"` to the
 * anchor when it injects the footer, because a reproduction page is a
 * leaf the visitor is actively running something on and shouldn't lose.
 * That difference is deliberate; the *text* is what must not diverge.
 *
 * Note this is distinct from `_components/VivariumFooter.tsx`, which is
 * the landing page's own large footer and is not shared with repro pages.
 */
export const FOOTER_MESSAGE_HTML = `Apache License 2.0 · part of <a href="${GITHUB_ORG_URL}">aletheia-works</a>`;

export interface FaviconLink {
  rel: string;
  type?: string;
  sizes: string;
  href: string;
}

/**
 * Favicon `<link>` attributes.
 *
 * rspress wants `['link', attrs]` tuples in `head[]`; chrome.js wants
 * plain objects to feed `setAttribute`. Export the objects and let
 * rspress.config.ts map them into tuples, so neither consumer forces its
 * shape on the other.
 */
export const FAVICONS: readonly FaviconLink[] = [
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '32x32',
    href: `${SITE_BASE}favicon-32x32.png`,
  },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '16x16',
    href: `${SITE_BASE}favicon-16x16.png`,
  },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '192x192',
    href: `${SITE_BASE}icon-192.png`,
  },
  {
    rel: 'apple-touch-icon',
    sizes: '180x180',
    href: `${SITE_BASE}apple-touch-icon.png`,
  },
];
