#!/usr/bin/env bun

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAYER1_DIR = dirname(SCRIPT_DIR);
const SRC_DIR = dirname(LAYER1_DIR);
const LAYER2_DIR = join(SRC_DIR, 'layer2_docker');

const MIRRORED = ['_assets', '_shared'] as const;

function isIdentical(src: string, dest: string): boolean {
  if (!existsSync(dest)) return false;
  const srcFiles = listFiles(src);
  const destFiles = listFiles(dest);
  if (srcFiles.length !== destFiles.length) return false;
  for (const rel of srcFiles) {
    if (!destFiles.includes(rel)) return false;
    const a = readFileSync(join(src, rel));
    const b = readFileSync(join(dest, rel));
    if (!a.equals(b)) return false;
  }
  return true;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

let changed = 0;
for (const name of MIRRORED) {
  const src = join(LAYER1_DIR, name);
  const dest = join(LAYER2_DIR, name);
  if (!existsSync(src)) {
    console.warn(`[sync-layer2-assets] missing source ${src}; skipping.`);
    continue;
  }
  if (isIdentical(src, dest)) continue;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[sync-layer2-assets] mirrored ${name}/ -> src/layer2_docker/`);
  changed += 1;
}

if (changed === 0) {
  console.log('[sync-layer2-assets] already up to date.');
}
