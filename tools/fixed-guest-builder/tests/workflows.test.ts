import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const DIRECTORY = new URL('../../../.github/workflows/', import.meta.url);
const NAMES = [
  'fixed-guest-build.yml',
  'fixed-guest-release.yml',
  'fixed-guest-bump.yml',
] as const;

type Step = {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  name?: string;
};
type Job = {
  if?: string;
  'timeout-minutes'?: number;
  environment?: string;
  permissions?: unknown;
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};

async function load(name: string): Promise<{ text: string; flow: Workflow }> {
  const text = await readFile(new URL(name, DIRECTORY), 'utf8');
  return { text, flow: Bun.YAML.parse(text) as Workflow };
}

const PERMISSIONS: Record<(typeof NAMES)[number], Record<string, string>> = {
  'fixed-guest-build.yml': { contents: 'read', actions: 'read' },
  'fixed-guest-release.yml': { contents: 'write', actions: 'read' },
  'fixed-guest-bump.yml': { contents: 'read', actions: 'read' },
};

describe('builder workflows', () => {
  test('start only by hand, on main, in the upstream repository', async () => {
    for (const name of NAMES) {
      const { flow } = await load(name);
      expect(Object.keys(flow.on)).toEqual(['workflow_dispatch']);
      for (const job of Object.values(flow.jobs)) {
        expect(job.if).toContain(
          "github.repository == 'aletheia-works/vivarium'",
        );
        expect(job.if).toContain("github.ref == 'refs/heads/main'");
        expect(job['timeout-minutes']).toBeGreaterThan(0);
      }
    }
  });

  test('grant exactly the permissions in the infrastructure design', async () => {
    for (const name of NAMES) {
      const { flow } = await load(name);
      expect(flow.permissions).toEqual(PERMISSIONS[name]);
      for (const job of Object.values(flow.jobs))
        expect(job.permissions).toBeUndefined();
    }
  });

  test('queue in their own group without cancelling a run in progress', async () => {
    for (const name of NAMES) {
      const { flow } = await load(name);
      expect(flow.concurrency).toEqual({
        group: name.replace('.yml', ''),
        'cancel-in-progress': false,
      });
    }
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
        for (const step of job.steps) {
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
        job.steps.filter((step) =>
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

  test('write the Release only behind the approval environment', async () => {
    const { flow } = await load('fixed-guest-release.yml');
    const jobs = Object.values(flow.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.environment).toBe('fixed-guest-release');
    const { text } = await load('fixed-guest-release.yml');
    expect(text).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template
      'run-name: release ${{ inputs.tool }} plan ${{ inputs.plan_sha256 }}',
    );
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
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template
      "title: 'fixed-guest: bump ${{ inputs.role }} in ${{ inputs.recipe }}'",
    );
    expect(text).not.toContain('inputs.tool');
  });

  test('open bump PRs with the bot and leave the merge to a person', async () => {
    const { flow } = await load('fixed-guest-bump.yml');
    const steps = Object.values(flow.jobs)[0]?.steps ?? [];
    const pr = steps.findIndex(
      (step) => step.uses === './.github/actions/bot-pull-request',
    );
    const disable = steps.findIndex((step) =>
      step.run?.includes('gh pr merge --disable-auto'),
    );
    expect(pr).toBeGreaterThan(-1);
    expect(disable).toBeGreaterThan(pr);
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
});
