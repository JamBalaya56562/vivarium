// Guards the Playwright container tag against the locked client version.
//
// The docs E2E lane runs inside `mcr.microsoft.com/playwright:vX.Y.Z-noble`
// instead of calling `playwright install --with-deps`. Playwright resolves
// browsers through a version-stamped directory under
// `PLAYWRIGHT_BROWSERS_PATH`, so the image tag and the `@playwright/test`
// version in `docs/bun.lock` must be the same release. When they diverge the
// suite dies with "Executable doesn't exist at /ms-playwright/...", which
// reads like a broken image rather than a version mismatch.
//
// Nothing keeps the two in step on its own: Dependabot updates package
// manifests but not `container.image` in a workflow file
// (dependabot/dependabot-core#5819), so enabling Dependabot on docs/ would
// bump the lockfile and silently leave the tag behind. Hence this test.
//
// Runs via `bun test scripts/__tests__` (docs `test:unit`).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOCS_DIR, REPO_ROOT } from '../site-paths';

const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'test-docs.yml');

/** The `@playwright/test` version bun resolved, read from the lockfile. */
function lockedVersion(lockPath: string): string {
  const lock = readFileSync(lockPath, 'utf-8');
  const m = /"@playwright\/test@(\d+\.\d+\.\d+)"/.exec(lock);
  if (!m?.[1]) {
    throw new Error(`no @playwright/test entry in ${lockPath}`);
  }
  return m[1];
}

/** The version encoded in the workflow's `container.image` tag. */
function imageVersion(): string {
  const yaml = readFileSync(WORKFLOW, 'utf-8');
  const m = /image:\s*mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/.exec(
    yaml,
  );
  if (!m?.[1]) {
    throw new Error(
      'no mcr.microsoft.com/playwright:vX.Y.Z-<distro> image in ' +
        '.github/workflows/test-docs.yml',
    );
  }
  return m[1];
}

describe('playwright container image — tag tracks the locked client', () => {
  test('the image tag matches docs/bun.lock', () => {
    const locked = lockedVersion(path.join(DOCS_DIR, 'bun.lock'));
    if (imageVersion() !== locked) {
      throw new Error(
        '.github/workflows/test-docs.yml pins ' +
          `mcr.microsoft.com/playwright:v${imageVersion()}-noble but ` +
          `docs/bun.lock resolves @playwright/test to ${locked}. Update the ` +
          'container image tag to match, or the E2E lane cannot find its ' +
          'browsers.',
      );
    }
    expect(imageVersion()).toBe(locked);
  });

  test('the tag is an exact version, never a floating one', () => {
    // `latest` (or a bare major) would drift away from the lockfile on
    // Microsoft's release schedule rather than ours, and the mismatch
    // would surface as a mid-suite browser-not-found on an unrelated PR.
    const yaml = readFileSync(WORKFLOW, 'utf-8');
    const tags = [...yaml.matchAll(/mcr\.microsoft\.com\/playwright:(\S+)/g)]
      .map((m) => m[1] ?? '')
      .filter((t) => !/^v\d+\.\d+\.\d+-[a-z]+$/.test(t));
    expect(tags).toEqual([]);
  });

  test('the Layer 1 suite resolves the same Playwright release', () => {
    // src/layer1_wasm still installs browsers on the plain runner, so it
    // is not bound to the image. Keeping the two lockfiles on one release
    // means a single version to reason about when a Playwright bug (or
    // fix) shows up in one lane and not the other.
    const docs = lockedVersion(path.join(DOCS_DIR, 'bun.lock'));
    const layer1 = lockedVersion(
      path.join(REPO_ROOT, 'src', 'layer1_wasm', 'bun.lock'),
    );
    expect({ docs, layer1 }).toEqual({ docs, layer1: docs });
  });
});
