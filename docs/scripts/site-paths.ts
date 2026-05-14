import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCS_DIR = path.resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const REPO_ROOT = path.resolve(DOCS_DIR, '..');

export const SITE_ROOT = path.join(DOCS_DIR, 'site');
export const SITE_BASE = '/vivarium/';
export const REPRO_BASE_PATH = `${SITE_BASE.replace(/\/$/, '')}/repro`;

export const SITE_PUBLIC_DIR = path.join(SITE_ROOT, 'public');
export const SITE_API_DIR = path.join(SITE_PUBLIC_DIR, 'api');
export const SITE_SPEC_DIR = path.join(SITE_PUBLIC_DIR, 'spec');

export const SITE_DATA_DIR = path.join(SITE_ROOT, '_data');
export const SITE_GENERATED_DIR = path.join(SITE_ROOT, '_generated');
export const SITE_GENERATED_VALIDATORS_DIR = path.join(
  SITE_GENERATED_DIR,
  'validators',
);
export const SITE_STATS_PATH = path.join(SITE_GENERATED_DIR, 'site-stats.json');
export const NAV_OVERRIDES_CSS = path.join(
  SITE_ROOT,
  '_styles',
  'nav-overrides.css',
);
