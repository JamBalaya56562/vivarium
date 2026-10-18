import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  COI_SERVICEWORKER_FILE,
  COI_SERVICEWORKER_SHA256,
  COI_SERVICEWORKER_VERSION,
  coiServiceWorkerProblem,
  findCoiServiceWorkerProblems,
} from '../coi-serviceworker-pin';
import { REPO_ROOT } from '../site-paths';

const FIXTURE = path.join(import.meta.dir, 'fixtures', COI_SERVICEWORKER_FILE);
const pinned = readFileSync(FIXTURE);

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function layer1(
  recipes: Record<string, { runtime?: string; copy?: Uint8Array }>,
): Promise<string> {
  dir = mkdtempSync(path.join(tmpdir(), 'vivarium-coi-'));
  for (const [slug, { runtime, copy }] of Object.entries(recipes)) {
    await mkdir(path.join(dir, slug));
    if (runtime)
      await writeFile(
        path.join(dir, slug, 'recipe.json'),
        JSON.stringify({
          schema_version: 1,
          language: 'shell',
          expected_runtime: runtime,
        }),
      );
    if (copy)
      await writeFile(path.join(dir, slug, COI_SERVICEWORKER_FILE), copy);
  }
  return dir;
}

describe('coi-serviceworker pin (BR2.4, NFR3.5)', () => {
  test('pins 0.1.7 and the fixture copied from its npm tarball matches', () => {
    expect(COI_SERVICEWORKER_VERSION).toBe('0.1.7');
    expect(COI_SERVICEWORKER_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(pinned).digest('hex')).toBe(
      COI_SERVICEWORKER_SHA256,
    );
    expect(pinned.toString('utf-8').split('\n')[0]).toContain(
      'coi-serviceworker v0.1.7',
    );
    expect(coiServiceWorkerProblem(FIXTURE)).toBeNull();
  });

  test('refuses a copy that differs by one byte', async () => {
    const changed = new Uint8Array(pinned);
    changed[changed.length - 2] ^= 0x01;
    const root = await layer1({
      demo: { runtime: 'formicarium', copy: changed },
    });
    const problems = findCoiServiceWorkerProblems(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('is not coi-serviceworker 0.1.7');
  });

  test('refuses a formicarium recipe, pending ones included, without its copy', async () => {
    const root = await layer1({
      pending: { runtime: 'formicarium' },
      other: { runtime: 'pyodide' },
    });
    const problems = findCoiServiceWorkerProblems(root);
    expect(problems).toEqual([
      `${path.join(root, 'pending', COI_SERVICEWORKER_FILE)}: missing`,
    ]);
  });

  test('accepts the pinned copy and checks copies of other runtimes too', async () => {
    const root = await layer1({
      demo: { runtime: 'formicarium', copy: pinned },
      other: { runtime: 'pyodide', copy: new TextEncoder().encode('x') },
    });
    const problems = findCoiServiceWorkerProblems(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(path.join('other', COI_SERVICEWORKER_FILE));
  });

  test('every copy in the tree matches the pin', () => {
    expect(
      findCoiServiceWorkerProblems(path.join(REPO_ROOT, 'src', 'layer1_wasm')),
    ).toEqual([]);
  });
});
