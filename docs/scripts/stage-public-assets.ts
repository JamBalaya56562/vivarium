#!/usr/bin/env bun
//
// Stages docs/public into docs/doc_build after rspress build.
//
// Rspress builds the human-facing pages into doc_build, while docs/public
// contains machine-readable endpoints that must be served as plain GitHub
// Pages files:
//
// - /api/recipes.json and /api/recipes.schema.json
// - /api/projects.json
// - /spec/manifest.schema.json
// - /spec/verdict.schema.json
//
// Keep this in the docs build rather than deploy-docs.yml so local preview,
// Playwright E2E, and the Pages artifact all observe the same doc_build tree.

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(SCRIPT_DIR, '..');
const PUBLIC_DIR = join(DOCS_DIR, 'public');
const OUT_DIR = join(DOCS_DIR, 'doc_build');

await mkdir(OUT_DIR, { recursive: true });
await cp(PUBLIC_DIR, OUT_DIR, {
  recursive: true,
  force: true,
  errorOnExist: false,
});

console.log(`[stage-public-assets] ${PUBLIC_DIR} -> ${OUT_DIR}`);
