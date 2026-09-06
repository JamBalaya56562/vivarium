import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runtimeShells } from '../generate-repro-pages';
import { REPO_ROOT } from '../site-paths';

const SHARED_DIR = path.join(REPO_ROOT, 'src', 'layer1_wasm', '_shared');

function withoutVersions(url: string): string {
  return url
    .replaceAll(/\$\{[^}]*\}/g, 'V')
    .replaceAll(/@\d[^/'"`\s]*/g, '@V')
    .replaceAll(/\/v\d[^/'"`\s]*/g, '/vV');
}

function loaderCdnUrls(): string[] {
  const sources = readdirSync(SHARED_DIR)
    .filter((f) => f.endsWith('_loader.ts') || f === 'loader.ts')
    .map((f) => readFileSync(path.join(SHARED_DIR, f), 'utf-8'))
    .join('\n');
  return [...sources.matchAll(/https:\/\/cdn\.jsdelivr\.net\/[^\s"'`]+/g)].map(
    (m) => withoutVersions(m[0] as string),
  );
}

function modulePreloadHrefs(preload: string): string[] {
  return [
    ...preload.matchAll(/rel="modulepreload"\s*\n\s*href="([^"]+)"/g),
  ].map((m) => m[1] as string);
}

describe('runtime shells — preloaded modules are modules a loader imports', () => {
  const imported = loaderCdnUrls();

  for (const [runtime, shell] of Object.entries(runtimeShells())) {
    const hrefs = modulePreloadHrefs(shell.preload);

    test(`${runtime} preloads at least one module`, () => {
      expect(hrefs.length).toBeGreaterThan(0);
    });

    for (const href of hrefs) {
      test(`${runtime} preloads ${href}, which a loader imports`, () => {
        expect(imported).toContain(withoutVersions(href));
      });
    }
  }
});
