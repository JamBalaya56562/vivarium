import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const DIRECTORY = new URL('../../../.github/workflows/', import.meta.url);
const NAMES = [
  'fixed-guest-build.yml',
  'fixed-guest-release.yml',
  'fixed-guest-bump.yml',
  'fixed-guest-prune.yml',
] as const;

type Step = {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  name?: string;
};
type Job = {
  name?: string;
  if?: string;
  'timeout-minutes'?: number;
  environment?: string;
  permissions?: unknown;
  needs?: string;
  uses?: string;
  with?: Record<string, unknown>;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  steps?: Step[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};

async function load(name: string): Promise<{ text: string; flow: Workflow }> {
  const text = await readFile(new URL(name, DIRECTORY), 'utf8');
  return { text, flow: Bun.YAML.parse(text) as Workflow };
}

const TRIGGERS: Record<(typeof NAMES)[number], string[]> = {
  'fixed-guest-build.yml': ['workflow_dispatch'],
  'fixed-guest-release.yml': ['workflow_dispatch', 'workflow_call'],
  'fixed-guest-bump.yml': ['workflow_dispatch'],
  'fixed-guest-prune.yml': ['schedule', 'workflow_dispatch'],
};

const READ = { contents: 'read', actions: 'read' };
const WRITE = { contents: 'write', actions: 'read' };
const PERMISSIONS: Record<
  (typeof NAMES)[number],
  { workflow: Record<string, string>; jobs: Record<string, unknown> }
> = {
  'fixed-guest-build.yml': {
    workflow: {},
    jobs: { build: READ, release: WRITE },
  },
  'fixed-guest-release.yml': {
    workflow: {},
    jobs: { prepare: READ, publish: WRITE, accept: READ },
  },
  'fixed-guest-bump.yml': { workflow: READ, jobs: { bump: undefined } },
  'fixed-guest-prune.yml': {
    workflow: {},
    jobs: { prune: { contents: 'write', 'pull-requests': 'read' } },
  },
};

describe('builder workflows', () => {
  test('start only by hand, from the build or on a schedule, on main, in the upstream repository', async () => {
    for (const name of NAMES) {
      const { flow } = await load(name);
      expect(Object.keys(flow.on)).toEqual(TRIGGERS[name]);
      for (const job of Object.values(flow.jobs)) {
        expect(job.if).toContain(
          "github.repository == 'aletheia-works/vivarium'",
        );
        expect(job.if).toContain("github.ref == 'refs/heads/main'");
        if (job.uses === undefined)
          expect(job['timeout-minutes']).toBeGreaterThan(0);
      }
    }
  });

  test('grant each job exactly the permissions it needs', async () => {
    for (const name of NAMES) {
      const { flow } = await load(name);
      expect(flow.permissions).toEqual(PERMISSIONS[name].workflow);
      expect(
        Object.fromEntries(
          Object.entries(flow.jobs).map(([id, job]) => [id, job.permissions]),
        ),
      ).toEqual(PERMISSIONS[name].jobs);
    }
  });

  // A concurrency group keeps one pending run and cancels the one before it,
  // so builds and releases take turns in the builder instead.
  test('never park a build or a release in a concurrency group', async () => {
    for (const name of ['fixed-guest-build.yml', 'fixed-guest-release.yml']) {
      const { flow } = await load(name);
      expect(flow.concurrency).toBeUndefined();
      for (const job of Object.values(flow.jobs))
        expect(job.concurrency).toBeUndefined();
    }
    const { flow } = await load('fixed-guest-bump.yml');
    expect(flow.concurrency).toEqual({
      group: 'fixed-guest-bump',
      'cancel-in-progress': false,
    });
  });

  test('show the plan SHA256 in the name of the publish job', async () => {
    const { flow } = await load('fixed-guest-release.yml');
    const { publish } = flow.jobs;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template
    const sha = '${{ needs.prepare.outputs.plan_sha256 }}';
    expect(publish?.name).toBe(`publish ${sha}`);
    expect(publish?.env?.PLAN_SHA256).toBe(sha);
  });

  test('pin every external action to a full SHA with a version comment', async () => {
    for (const name of NAMES) {
      const { text } = await load(name);
      for (const line of text.split('\n')) {
        const match = /^\s*(?:-\s+)?uses:\s+(\S+)(.*)$/.exec(line);
        if (match === null) continue;
        const [, ref, rest] = match;
        if (ref?.startsWith('./')) continue;
        expect(ref).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
        expect(rest).toMatch(/^ # v\d/);
      }
    }
  });

  test('never expand inputs inside a shell script and never keep checkout credentials', async () => {
    for (const name of NAMES) {
      const { flow } = await load(name);
      for (const job of Object.values(flow.jobs))
        for (const step of job.steps ?? []) {
          if (step.run !== undefined) expect(step.run).not.toContain('${{');
          if (step.uses?.startsWith('actions/checkout@'))
            expect(step.with?.['persist-credentials']).toBe(false);
        }
    }
  });

  test('save the mbx cache only from main and only in the build workflow', async () => {
    for (const name of NAMES) {
      const { flow } = await load(name);
      const saves = Object.values(flow.jobs).flatMap((job) =>
        (job.steps ?? []).filter((step) =>
          step.uses?.startsWith('actions/cache/save@'),
        ),
      );
      if (name !== 'fixed-guest-build.yml') {
        expect(saves).toEqual([]);
        continue;
      }
      expect(saves).toHaveLength(1);
      expect(saves[0]?.if).toContain("github.ref == 'refs/heads/main'");
      expect(saves[0]?.if).toContain(
        "github.event_name == 'workflow_dispatch'",
      );
      expect(saves[0]?.if).toContain(
        "steps.mbx-cache.outputs.cache-hit != 'true'",
      );
      expect(String(saves[0]?.with?.key)).not.toContain('run_id');
    }
  });

  test('take only the build run ID, from a person or from the build', async () => {
    const { flow } = await load('fixed-guest-release.yml');
    const on = flow.on as Record<string, { inputs: Record<string, unknown> }>;
    expect(Object.keys(on.workflow_dispatch?.inputs ?? {})).toEqual([
      'build_run_id',
    ]);
    expect(Object.keys(on.workflow_call?.inputs ?? {})).toEqual([
      'build_run_id',
    ]);
  });

  test('plan without write access and write the Release under that plan, with no approval environment', async () => {
    const { flow } = await load('fixed-guest-release.yml');
    const { prepare, publish } = flow.jobs;
    expect(Object.keys(flow.jobs)).toEqual(['prepare', 'publish', 'accept']);
    for (const job of Object.values(flow.jobs))
      expect(job.environment).toBeUndefined();
    const plan = prepare?.steps?.find((step) => step.name === 'Make the plan');
    expect(plan?.run).toContain('src/cli.ts prepare');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion in the workflow, not a JS template
    expect(plan?.run).toContain('--summary "${GITHUB_STEP_SUMMARY}"');
    expect(plan?.run).toContain('plan_sha256=');
    expect(prepare?.outputs?.plan_sha256).toContain(
      'steps.plan.outputs.plan_sha256',
    );
    expect(publish?.needs).toBe('prepare');
    expect(publish?.env?.PLAN_SHA256).toContain(
      'needs.prepare.outputs.plan_sha256',
    );
    const write = publish?.steps?.find((step) =>
      step.run?.includes('src/cli.ts release'),
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion in the workflow, not a JS template
    expect(write?.run).toContain('--plan-sha256 "${PLAN_SHA256}"');
    const uploaded = prepare?.steps?.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    const fetched = publish?.steps?.filter((step) =>
      step.uses?.startsWith('actions/download-artifact@'),
    );
    expect(fetched?.map((step) => step.with?.name)).toContain(
      uploaded?.with?.name,
    );
  });

  test('accept the published build through a bot pull request, only when a recipe changed', async () => {
    const { flow } = await load('fixed-guest-release.yml');
    const { publish, accept } = flow.jobs;
    expect(accept?.needs).toBe('publish');
    const checkout = accept?.steps?.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout?.with?.ref).toBe('main');
    const kept = publish?.steps?.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    const fetched = accept?.steps?.find((step) =>
      step.uses?.startsWith('actions/download-artifact@'),
    );
    expect(fetched?.with?.name).toBe(kept?.with?.name);
    const run = accept?.steps?.find((step) =>
      step.run?.includes('src/cli.ts accept'),
    );
    expect(run?.run).toContain('src/layer1_wasm');
    const pr = accept?.steps?.find(
      (step) => step.uses === './.github/actions/bot-pull-request',
    );
    expect(pr?.if).toBe("steps.accept.outputs.changed == 'true'");
    const on = flow.on as Record<string, { secrets?: Record<string, unknown> }>;
    expect(Object.keys(on.workflow_call?.secrets ?? {})).toEqual([
      'BOT_PRIVATE_KEY',
    ]);
  });

  test('the build calls the release after a successful build of its own run', async () => {
    const { flow } = await load('fixed-guest-build.yml');
    const { release } = flow.jobs;
    expect(release?.needs).toBe('build');
    expect(release?.uses).toBe('./.github/workflows/fixed-guest-release.yml');
    expect(release?.with?.build_run_id).toContain('github.run_id');
    expect(release?.if).not.toContain('always()');
  });

  test('bump one guest by role and name its branch and title by role', async () => {
    const { flow, text } = await load('fixed-guest-bump.yml');
    const inputs = (
      flow.on.workflow_dispatch as {
        inputs: Record<string, { type: string; options?: string[] }>;
      }
    ).inputs;
    expect(Object.keys(inputs).sort()).toEqual(['recipe', 'role']);
    expect(inputs.role).toMatchObject({
      type: 'choice',
      options: ['baseline', 'fix'],
    });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion in the workflow, not a JS template
    expect(text).toContain('--role "${ROLE}"');
    expect(text).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion in the workflow, not a JS template
      'echo "branch=fixed-guest-bump/${slug}-${ROLE}" >> "${GITHUB_OUTPUT}"',
    );
    expect(text).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion in the workflow, not a JS template
      'echo "slug=${slug}" >> "${GITHUB_OUTPUT}"',
    );
    // The title is also the bot's commit message, which commitlint checks as
    // a conventional commit header of at most 100 characters.
    const title = /^ {10}title: '(.+)'$/m.exec(text)?.[1] ?? '';
    expect(title).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template
      'chore(layer1): bump the ${{ inputs.role }} guest of ${{ steps.bump.outputs.slug }}',
    );
    expect(title).toMatch(/^[a-z]+\([a-z0-9-]+\): [a-z]/);
    expect(text).not.toContain('inputs.tool');
  });

  test('open bump PRs with the bot and let them merge themselves', async () => {
    const { text, flow } = await load('fixed-guest-bump.yml');
    const steps = Object.values(flow.jobs)[0]?.steps ?? [];
    const pr = steps.findIndex(
      (step) => step.uses === './.github/actions/bot-pull-request',
    );
    expect(pr).toBeGreaterThan(-1);
    // bot-pull-request enables auto-merge; nothing after it turns it off.
    expect(pr).toBe(steps.length - 1);
    expect(text).not.toContain('--disable-auto');
    const token = steps.find((step) =>
      step.uses?.startsWith('actions/create-github-app-token@'),
    );
    expect(token?.with).toMatchObject({
      'permission-contents': 'write',
      'permission-pull-requests': 'write',
    });
  });

  test('passes the requested and matched mbx cache keys to the build', async () => {
    const { flow } = await load('fixed-guest-build.yml');
    const steps = Object.values(flow.jobs)[0]?.steps ?? [];
    const build = steps.find(
      (step) => step.name === 'Build or reuse',
    ) as Step & { env?: Record<string, string> };
    expect(build.env?.MBX_CACHE_REQUESTED_KEY).toContain(
      'steps.mbx-cache.outputs.cache-primary-key',
    );
    expect(build.env?.MBX_CACHE_MATCHED_KEY).toContain(
      'steps.mbx-cache.outputs.cache-matched-key',
    );
  });

  test('prune from the full history, deleting on schedule and dry by default by hand', async () => {
    const { flow } = await load('fixed-guest-prune.yml');
    const inputs = (
      flow.on.workflow_dispatch as {
        inputs: Record<string, { type: string; default: unknown }>;
      }
    ).inputs;
    expect(inputs).toEqual({
      dry_run: expect.objectContaining({ type: 'boolean', default: true }),
    });
    const { prune } = flow.jobs;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template
    expect(prune?.env?.DRY_RUN).toBe("${{ inputs.dry_run || 'false' }}");
    const checkout = prune?.steps?.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    const run = prune?.steps?.find((step) =>
      step.run?.includes('src/cli.ts prune'),
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion in the workflow, not a JS template
    expect(run?.run).toContain('--dry-run "${DRY_RUN}"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion in the workflow, not a JS template
    expect(run?.run).toContain('--summary "${GITHUB_STEP_SUMMARY}"');
    expect(flow.concurrency).toEqual({
      group: 'fixed-guest-prune',
      'cancel-in-progress': false,
    });
  });
});
