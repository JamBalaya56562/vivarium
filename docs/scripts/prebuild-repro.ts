#!/usr/bin/env bun
//
// Pre-build step for individual reproduction pages.
//
// Each reproduction under `src/layer1_wasm/<slug>/` ships a `repro.ts`
// that imports the runtime loader and exports verdict-setting calls. The
// browser HTML page references the compiled `./repro.js` — but `tsc`
// compiles it next to the source (per src/layer1_wasm/tsconfig.json's
// `outDir: "."`), and the .js outputs are gitignored.
//
// On a fresh checkout, those .js files don't exist yet, so the dev
// server's repro middleware would serve a 404 for `repro.js` requests.
// This script ensures the TypeScript is compiled before rspress dev
// serves the pages.
//
// Wired into `bun run dev` via docs/package.json. If neither bun nor
// the tsc binary is reachable, it exits 0 with a clear instruction so
// `bun run dev` still proceeds — visual preview of the new design works
// without compiled .js, only the in-page Pyodide runtime won't.
//
// Layer 2 (Docker) and Layer 3 (record-replay) reproduction pages don't
// have this client-side TS build step — they're plain static HTML
// documenting recipes that run via `docker run` outside the browser.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const LAYER1_DIR = join(REPO_ROOT, 'src', 'layer1_wasm');
const NODE_MODULES = join(LAYER1_DIR, 'node_modules');
const IS_WIN = process.platform === 'win32';

if (!existsSync(LAYER1_DIR)) {
  console.log('[prebuild-repro] no src/layer1_wasm/; skipping.');
  process.exit(0);
}

/**
 * Try to invoke the currently-running bun (process.argv0) for `install`
 * + `build`. process.argv0 holds the absolute path to the binary that
 * launched this script, which works even when bun isn't on the shell
 * PATH (e.g. when rspress's dev launcher invokes us).
 */
function tryBun(): boolean {
  const bunBin = process.argv0;
  if (!bunBin || !bunBin.toLowerCase().includes('bun')) return false;

  if (!existsSync(NODE_MODULES)) {
    console.log(`[prebuild-repro] bun install (in ${LAYER1_DIR})`);
    const r = spawnSync(bunBin, ['install', '--silent'], {
      cwd: LAYER1_DIR,
      stdio: 'inherit',
      shell: false,
    });
    if (r.status !== 0) return false;
  }

  console.log('[prebuild-repro] bun run build');
  const r = spawnSync(bunBin, ['run', 'build'], {
    cwd: LAYER1_DIR,
    stdio: 'inherit',
    shell: false,
  });
  return r.status === 0;
}

/**
 * Fallback: if bun isn't usable but `node_modules/.bin/tsc` already
 * exists from a prior install, run tsc directly.
 */
function tryTsc(): boolean {
  const tscBin = join(NODE_MODULES, '.bin', IS_WIN ? 'tsc.cmd' : 'tsc');
  if (!existsSync(tscBin)) return false;
  console.log('[prebuild-repro] tsc -p tsconfig.json (direct)');
  const r = spawnSync(tscBin, ['-p', 'tsconfig.json'], {
    cwd: LAYER1_DIR,
    stdio: 'inherit',
    shell: false,
  });
  return r.status === 0;
}

if (!(tryBun() || tryTsc())) {
  console.warn('[prebuild-repro] tsc skipped — bun and tsc both unreachable.');
  console.warn('  To enable Pyodide / Ruby.wasm runtime in repro pages, run:');
  console.warn('    cd src/layer1_wasm && bun install && bun run build');
}

// Optional: build Rust repros if cargo + wasm32-wasip1 are available.
// The `repro.wasm` artefact ends up next to the recipe's index.html,
// where the dev middleware serves it. Without this step, Rust repro
// pages get a 404 for repro.wasm in dev (and a friendly error message
// from the middleware rather than a broken WebAssembly.compile call).

function findCargo(): string | null {
  const candidates = [
    process.env['CARGO_HOME'] ? join(process.env['CARGO_HOME']!, 'bin', IS_WIN ? 'cargo.exe' : 'cargo') : null,
    process.env['HOME'] ? join(process.env['HOME']!, '.cargo', 'bin', IS_WIN ? 'cargo.exe' : 'cargo') : null,
    process.env['USERPROFILE'] ? join(process.env['USERPROFILE'], '.cargo', 'bin', 'cargo.exe') : null,
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function tryRust(): void {
  const cargo = findCargo();
  if (!cargo) {
    console.log('[prebuild-repro] Rust skipped — cargo not found. Rust repros will 404 in dev until cargo + wasm32-wasip1 are installed.');
    return;
  }

  // Find every Cargo.toml under src/layer1_wasm/.
  let crateDirs: string[] = [];
  try {
    crateDirs = readdirSync(LAYER1_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(LAYER1_DIR, e.name, 'Cargo.toml')))
      .map((e) => join(LAYER1_DIR, e.name));
  } catch {
    return;
  }
  if (crateDirs.length === 0) return;

  // Ensure wasm32-wasip1 target is installed (cheap if already).
  const rustup = cargo.replace(/cargo(\.exe)?$/, 'rustup$1');
  if (existsSync(rustup)) {
    console.log('[prebuild-repro] ensuring wasm32-wasip1 target...');
    spawnSync(rustup, ['target', 'add', 'wasm32-wasip1'], { stdio: 'inherit', shell: false });
  }

  for (const dir of crateDirs) {
    console.log(`[prebuild-repro] cargo build --release --target wasm32-wasip1 (${dir})`);
    const r = spawnSync(
      cargo,
      ['build', '--release', '--target', 'wasm32-wasip1'],
      { cwd: dir, stdio: 'inherit', shell: false },
    );
    if (r.status !== 0) {
      console.warn(`  [warn] build failed for ${dir} — Rust repro will 404 in dev.`);
      continue;
    }
    // Copy the built wasm next to index.html (matches the deploy
    // pipeline's `cp` in .github/workflows/deploy-docs.yml).
    const wasmFrom = join(dir, 'target', 'wasm32-wasip1', 'release', 'repro.wasm');
    const wasmTo = join(dir, 'repro.wasm');
    if (existsSync(wasmFrom)) {
      copyFileSync(wasmFrom, wasmTo);
      console.log(`  [ok] copied repro.wasm to ${dir}`);
    }
  }
}

tryRust();

console.log('[prebuild-repro] done.');
process.exit(0);
