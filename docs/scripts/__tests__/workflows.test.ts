import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../site-paths';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'timeout-minutes'?: number;
  'working-directory'?: string;
}

interface Job {
  'timeout-minutes'?: number;
  permissions?: unknown;
  steps: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}

function load(name: string): { text: string; flow: Workflow } {
  const text = readFileSync(
    path.join(REPO_ROOT, '.github', 'workflows', name),
    'utf-8',
  );
  return { text, flow: Bun.YAML.parse(text) as Workflow };
}

const STAGER = 'bun docs/scripts/stage-formicarium-assets.ts';

function index(steps: Step[], match: (step: Step) => boolean): number {
  const found = steps.findIndex(match);
  expect(found).toBeGreaterThan(-1);
  return found;
}

function stagerSteps(steps: Step[]): Step[] {
  return steps.filter((step) => step.run?.includes(STAGER));
}

function expectNoSecrets(step: Step): void {
  expect(JSON.stringify(step.env ?? {})).not.toMatch(
    /secrets\.|github\.token|TOKEN/,
  );
  expect(step.run ?? '').not.toMatch(/secrets\.|github\.token|_TOKEN/);
}

describe('deploy-docs stages formicarium assets in pin mode only (S2, NFR8.4)', () => {
  const { text, flow } = load('deploy-docs.yml');
  const steps = flow.jobs.build?.steps ?? [];

  test('runs the AssetStager right after repro:i18n, before the Rust clean-up and Layer 2', () => {
    const i18n = index(steps, (s) => s.run === 'mise run repro:i18n');
    const stage = index(steps, (s) => s.run === `${STAGER} --mode pin`);
    const rust = index(
      steps,
      (s) => s.name === 'Drop Rust build artefacts before bundling',
    );
    expect(stage).toBe(i18n + 1);
    expect(rust).toBe(stage + 1);
    expect(steps[stage]?.['timeout-minutes']).toBe(7);
    expectNoSecrets(steps[stage] as Step);
  });

  test('checks the bundled site after both bundles and before the upload', () => {
    const layer2 = index(
      steps,
      (s) => s.run === 'bash scripts/bundle-layer2-pages.sh',
    );
    const check = index(
      steps,
      (s) => s.run === `${STAGER} --mode check-site --site docs/doc_build`,
    );
    const upload = index(
      steps,
      (s) => s.uses?.startsWith('actions/upload-pages-artifact@') ?? false,
    );
    expect(check).toBe(layer2 + 1);
    expect(upload).toBe(check + 1);
    expectNoSecrets(steps[check] as Step);
  });

  test('uploads the hidden files the site ships (Step 18a)', () => {
    const upload = steps.find(
      (s) => s.uses?.startsWith('actions/upload-pages-artifact@') ?? false,
    );
    expect(upload?.with?.['include-hidden-files']).toBe(true);
  });

  test('uses no local mode and no other stager command', () => {
    expect(text).not.toContain('--mode local');
    expect(stagerSteps(steps).map((s) => s.run)).toEqual([
      `${STAGER} --mode pin`,
      `${STAGER} --mode check-site --site docs/doc_build`,
    ]);
  });

  test('keeps its permissions and triggers, and does not persist the checkout token', () => {
    expect(flow.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
      packages: 'write',
    });
    expect(Object.keys(flow.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect((flow.on.push as { branches: string[] }).branches).toEqual(['main']);
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    expect(text).not.toMatch(/\bgit push\b/);
  });
});

describe('repro-regression stages before Playwright (R-10)', () => {
  const { text, flow } = load('repro-regression.yml');
  const job = flow.jobs.regression as Job;
  const steps = job.steps;

  test('stages in pin mode after the Layer 1 build and before the Playwright suite', () => {
    const build = index(
      steps,
      (s) => s.run?.includes('mise run repro:build') ?? false,
    );
    const stage = index(steps, (s) => s.run === `${STAGER} --mode pin`);
    const playwright = index(
      steps,
      (s) => s.run?.startsWith('bun run test --') ?? false,
    );
    expect(stage).toBe(build + 1);
    expect(playwright).toBeGreaterThan(stage);
    expect(steps[stage]?.['timeout-minutes']).toBe(7);
    expectNoSecrets(steps[stage] as Step);
    expect(text).not.toContain('--mode local');
  });

  test('checks the formicarium types against the pinned tarball, not skipped', () => {
    const stage = index(steps, (s) => s.run === `${STAGER} --mode pin`);
    const types = index(
      steps,
      (s) => s.run?.includes('formicariumTypes.test.ts') ?? false,
    );
    expect(types).toBe(stage + 1);
    const run = steps[types]?.run ?? '';
    expect(run).toContain('formicarium.pin.json');
    expect(run).toContain('sha256sum --check --strict');
    expect(run).toContain('FORMICARIUM_LOCAL_TARBALL="$tarball"');
    expect(steps[types]?.['timeout-minutes']).toBe(5);
    expectNoSecrets(steps[types] as Step);
  });

  test('keeps the job budget, the browsers and the read-only permission', () => {
    expect(job['timeout-minutes']).toBe(20);
    expect(flow.permissions).toEqual({ contents: 'read' });
    expect(text).toContain('browser: [chromium, firefox, webkit]');
  });
});
