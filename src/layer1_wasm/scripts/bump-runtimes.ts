#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYER1_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SHARED_DIR = join(LAYER1_DIR, '_shared');
const REPO_ROOT = dirname(dirname(LAYER1_DIR));

interface Pin {
  label: string;
  file: string;
  name: string;
}

interface NpmPackument {
  'dist-tags': { latest: string };
  versions: Record<string, { dependencies?: Record<string, string> }>;
}

const PYODIDE: Pin = { label: 'Pyodide', file: 'loader.ts', name: 'DEFAULT_PYODIDE_VERSION' };
const RUBY_WASM: Pin = { label: 'ruby.wasm', file: 'ruby_loader.ts', name: 'DEFAULT_RUBY_WASM_VERSION' };
const RUBY: Pin = { label: 'Ruby (ruby.wasm line)', file: 'ruby_loader.ts', name: 'DEFAULT_RUBY_VERSION' };
const RUBY_WASI_SHIM: Pin = { label: 'browser_wasi_shim (Ruby)', file: 'ruby_loader.ts', name: 'DEFAULT_WASI_SHIM_VERSION' };
const RUST_WASI_SHIM: Pin = { label: 'browser_wasi_shim (Rust)', file: 'rust_loader.ts', name: 'DEFAULT_WASI_SHIM_VERSION' };

function pinPattern(pin: Pin): RegExp {
  return new RegExp(`(export const ${pin.name}\\s*=\\s*["'])([^"']+)(["'])`);
}

function readPin(pin: Pin): string {
  const match = readFileSync(join(SHARED_DIR, pin.file), 'utf-8').match(pinPattern(pin));
  if (!match?.[2]) throw new Error(`${pin.name} not found in _shared/${pin.file}`);
  return match[2];
}

function writePin(pin: Pin, value: string): void {
  const path = join(SHARED_DIR, pin.file);
  const body = readFileSync(path, 'utf-8');
  writeFileSync(path, body.replace(pinPattern(pin), `$1${value}$3`));
}

async function packument(name: string): Promise<NpmPackument | null> {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${name}`);
  return (await res.json()) as NpmPackument;
}

async function requirePackument(name: string): Promise<NpmPackument> {
  const doc = await packument(name);
  if (!doc) throw new Error(`${name} is not on the npm registry`);
  return doc;
}

async function assertReachable(url: string): Promise<void> {
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
}

function newestStable(versions: string[], range?: string): string {
  const candidates = versions
    .filter((v) => !v.includes('-'))
    .filter((v) => range === undefined || Bun.semver.satisfies(v, range))
    .sort(Bun.semver.order);
  const newest = candidates.at(-1);
  if (!newest) throw new Error(`no stable version matches ${range ?? '*'}`);
  return newest;
}

async function rubyLine(current: string, rubyWasm: string): Promise<string> {
  const [major, minor] = current.split('.').map(Number) as [number, number];
  for (const line of [`${major + 1}.0`, `${major}.${minor + 1}`, current]) {
    const doc = await packument(`@ruby/${line}-wasm-wasi`);
    if (doc?.versions[rubyWasm]) return line;
  }
  throw new Error(`no @ruby/<line>-wasm-wasi package has version ${rubyWasm}`);
}

function mentions(version: string): string[] {
  const proc = Bun.spawnSync(
    ['git', 'grep', '-n', '-F', version, '--', '.', ':!**/bun.lock', ':!src/layer1_wasm/_shared/*loader.ts'],
    { cwd: REPO_ROOT },
  );
  return proc.stdout.toString().split('\n').filter(Boolean);
}

const pyodide = (await requirePackument('pyodide'))['dist-tags'].latest;
await assertReachable(`https://cdn.jsdelivr.net/pyodide/v${pyodide}/full/pyodide.mjs`);

const rubyWasmDoc = await requirePackument('@ruby/wasm-wasi');
const rubyWasm = rubyWasmDoc['dist-tags'].latest;
const ruby = await rubyLine(readPin(RUBY), rubyWasm);

const shimVersions = Object.keys((await requirePackument('@bjorn3/browser_wasi_shim')).versions);
const rubyShimRange = rubyWasmDoc.versions[rubyWasm]?.dependencies?.['@bjorn3/browser_wasi_shim'];

const targets: Array<[Pin, string]> = [
  [PYODIDE, pyodide],
  [RUBY_WASM, rubyWasm],
  [RUBY, ruby],
  [RUBY_WASI_SHIM, newestStable(shimVersions, rubyShimRange)],
  [RUST_WASI_SHIM, newestStable(shimVersions)],
];

const bumps = targets
  .map(([pin, to]) => ({ pin, from: readPin(pin), to }))
  .filter(({ from, to }) => from !== to);

for (const { pin, to } of bumps) writePin(pin, to);

if (bumps.length > 0) {
  const lines = [
    '| Runtime | From | To | Pin |',
    '| --- | --- | --- | --- |',
    ...bumps.map(
      ({ pin, from, to }) =>
        `| ${pin.label} | \`${from}\` | \`${to}\` | \`${relative(REPO_ROOT, join(SHARED_DIR, pin.file)).replaceAll('\\', '/')}\` \`${pin.name}\` |`,
    ),
  ];
  const stale = [...new Set(bumps.flatMap(({ from }) => mentions(from)))];
  if (stale.length > 0) {
    lines.push(
      '',
      '<details><summary>Other mentions of the old versions</summary>',
      '',
      '```text',
      ...stale,
      '```',
      '',
      '</details>',
    );
  }
  console.log(lines.join('\n'));
}
