import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runtimeShells } from '../generate-repro-pages';
import { REPO_ROOT } from '../site-paths';

const SHARED_DIR = path.join(REPO_ROOT, 'src', 'layer1_wasm', '_shared');

const LOADER_FOR_RUNTIME: Record<string, string> = {
  pyodide: 'loader.ts',
  'php-wasm': 'php_loader.ts',
  'ruby.wasm': 'ruby_loader.ts',
  'rust-wasi': 'rust_loader.ts',
};

function resolvedCdnUrls(loaderFile: string): string[] {
  const source = readFileSync(path.join(SHARED_DIR, loaderFile), 'utf-8');

  const values = new Map<string, string>();
  for (const m of source.matchAll(
    /export const (\w+)\s*=\s*["']([^"']+)["']/g,
  )) {
    values.set(m[1] as string, m[2] as string);
  }
  for (const m of source.matchAll(/const (\w+) = options\.\w+ \?\? (\w+);/g)) {
    const target = values.get(m[2] as string);
    if (target !== undefined) values.set(m[1] as string, target);
  }

  const urls: string[] = [];
  for (const m of source.matchAll(/https:\/\/cdn\.jsdelivr\.net\/[^\s"'`]+/g)) {
    const resolved = (m[0] as string).replaceAll(
      /\$\{(\w+)\}/g,
      (whole, name: string) => values.get(name) ?? whole,
    );
    if (!resolved.includes('${')) urls.push(resolved);
  }
  return urls;
}

function modulePreloadHrefs(preload: string): string[] {
  return [
    ...preload.matchAll(/rel="modulepreload"\s*\n\s*href="([^"]+)"/g),
  ].map((m) => m[1] as string);
}

describe('runtime shells — preloaded modules come from the backing loader', () => {
  for (const [runtime, shell] of Object.entries(runtimeShells())) {
    const loaderFile = LOADER_FOR_RUNTIME[runtime];
    const hrefs = modulePreloadHrefs(shell.preload);

    test(`${runtime} maps to a known loader`, () => {
      expect(loaderFile).toBeDefined();
    });

    if (!loaderFile) continue;
    const imported = resolvedCdnUrls(loaderFile);

    for (const href of hrefs) {
      test(`${runtime} preloads ${href}, which ${loaderFile} imports at that version`, () => {
        expect(imported).toContain(href);
      });
    }
  }
});

test('pyodide preloads nothing, because it runs in a worker', () => {
  const shell = runtimeShells().pyodide;
  expect(shell?.preload).toBe('');
});

test('every runtime that is not pyodide preloads at least one module', () => {
  for (const [runtime, shell] of Object.entries(runtimeShells())) {
    if (runtime === 'pyodide') continue;
    expect(modulePreloadHrefs(shell.preload).length).toBeGreaterThan(0);
  }
});
