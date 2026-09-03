import { SITE_BASE } from './site-paths';

export const GITHUB_ORG_URL = 'https://github.com/aletheia-works';
export const GITHUB_REPO_URL = `${GITHUB_ORG_URL}/vivarium`;
export const DOC_REPO_BASE_URL = `${GITHUB_REPO_URL}/tree/main/docs/site`;

export const FOOTER_MESSAGE_HTML = `Apache License 2.0 · part of <a href="${GITHUB_ORG_URL}">aletheia-works</a>`;

export interface FaviconLink {
  rel: string;
  type?: string;
  sizes: string;
  href: string;
}

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
