// MCP tool that opens a draft PR on the upstream repository from the
// contributor's already-pushed fork branch. The output side of the
// round-trip loop — the first step that crosses the boundary from
// "internal verification" to "publicly visible state change".
//
// Phase 4 of the round-trip automation. Conservative by design:
//   - dry_run defaults to true; explicit opt-in needed to actually
//     create the PR.
//   - The PR is always opened with --draft. Merging out of draft
//     stays a human action.
//   - The `ai: generated` label is always applied (AGENTS.md §4.6).
//   - The tool refuses to run unless the round-trip is verified
//     (verdicts.unfixed=reproduced AND verdicts.fixed=unreproduced).
//   - Local clone, commit, and push are caller responsibilities —
//     this tool does NOT mutate the working tree. The fork branch
//     must already exist on GitHub before calling.

import { spawnSync } from 'node:child_process';

import { getCatalogue } from '../catalogue.js';
import type { RoundtripState } from '../types.js';
import { parseUpstreamIssue } from './verify_and_report_fix.js';

export interface CreateForkPrArgs {
  slug: string;
  current_state: Partial<RoundtripState>;
  pr_title: string;
  pr_body?: string;
  dry_run?: boolean;
}

export interface CreateForkPrOk {
  ok: true;
  slug: string;
  upstream_repo: string;
  head: string;
  title: string;
  body: string;
  labels: string[];
  draft: true;
  dry_run: boolean;
  command: string;
  pr_url?: string;
}

export interface CreateForkPrError {
  ok: false;
  error: string;
}

export type CreateForkPrResult = CreateForkPrOk | CreateForkPrError;

export interface GhRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[]) => GhRunResult;

const defaultGhRunner: GhRunner = (args) => {
  const r = spawnSync('gh', args, {
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
};

let ghRunner: GhRunner = defaultGhRunner;

export function _setGhRunnerForTesting(runner: GhRunner | null): void {
  ghRunner = runner ?? defaultGhRunner;
}

const AI_GENERATED_LABEL = 'ai: generated';

function quoteShell(value: string): string {
  // Single-quote and escape any embedded single quote — produces
  // a shell-safe representation for the returned `command` string.
  // Real execution goes through spawn with argv arrays, so this
  // affects only what the caller sees as a paste-ready line.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function createForkPr(
  args: CreateForkPrArgs,
): Promise<CreateForkPrResult> {
  const slug = args.slug?.trim();
  if (!slug) {
    return { ok: false, error: 'missing required argument: slug' };
  }

  const title = args.pr_title?.trim();
  if (!title) {
    return { ok: false, error: 'pr_title is required' };
  }

  const { recipes } = await getCatalogue();
  const recipe = recipes.find((r) => r.slug === slug);
  if (!recipe) {
    return { ok: false, error: `recipe not found: ${slug}` };
  }

  const state = args.current_state;
  if (!state || typeof state !== 'object') {
    return { ok: false, error: 'current_state is required' };
  }

  // Verdict preconditions — guardrail 5.
  const unfixed = state.verdicts?.unfixed;
  const fixed = state.verdicts?.fixed;
  if (unfixed?.verdict !== 'reproduced') {
    return {
      ok: false,
      error: `round-trip is not verified: verdicts.unfixed.verdict must be "reproduced" (current: ${unfixed?.verdict ?? 'missing'})`,
    };
  }
  if (fixed?.verdict !== 'unreproduced') {
    return {
      ok: false,
      error: `round-trip is not verified: verdicts.fixed.verdict must be "unreproduced" (current: ${fixed?.verdict ?? 'missing'})`,
    };
  }

  // Upstream owner/repo from upstream_issue URL.
  const upstream = parseUpstreamIssue(state.upstream_issue);
  if (!upstream) {
    return {
      ok: false,
      error: `cannot derive upstream owner/repo from current_state.upstream_issue (got "${state.upstream_issue ?? 'missing'}"). Expected form: https://github.com/<owner>/<repo>/issues/<n>.`,
    };
  }

  // Fork coordinates.
  const fork = state.fork;
  if (
    !fork ||
    !fork.owner?.trim() ||
    !fork.repo?.trim() ||
    !fork.branch?.trim()
  ) {
    return {
      ok: false,
      error:
        'current_state.fork must have owner, repo, and branch (the contributor fork the candidate fix lives on)',
    };
  }

  const upstreamRepo = `${upstream.owner}/${upstream.repo}`;
  const head = `${fork.owner}:${fork.branch}`;
  const body = args.pr_body ?? '';
  const labels = [AI_GENERATED_LABEL];
  const dryRun = args.dry_run !== false; // default true

  // Build a paste-ready command string. spawn execution below uses an
  // argv array, not this string — they share the same arguments.
  const command = [
    'gh',
    'pr',
    'create',
    '--repo',
    upstreamRepo,
    '--head',
    head,
    '--draft',
    '--label',
    quoteShell(AI_GENERATED_LABEL),
    '--title',
    quoteShell(title),
    '--body',
    quoteShell(body),
  ].join(' ');

  if (dryRun) {
    return {
      ok: true,
      slug,
      upstream_repo: upstreamRepo,
      head,
      title,
      body,
      labels,
      draft: true,
      dry_run: true,
      command,
    };
  }

  // dry_run=false → execute. Pre-flight checks first so a partial
  // failure doesn't leave the PR half-opened.

  // Guardrail 2: gh auth must be set up.
  const authCheck = ghRunner(['auth', 'status']);
  if (authCheck.status !== 0) {
    return {
      ok: false,
      error: `gh auth check failed: ${authCheck.stderr.trim() || '<no stderr>'}. Run 'gh auth login' first.`,
    };
  }

  // Fork must exist and be reachable by the active gh auth.
  const forkCheck = ghRunner([
    'repo',
    'view',
    `${fork.owner}/${fork.repo}`,
    '--json',
    'name',
  ]);
  if (forkCheck.status !== 0) {
    return {
      ok: false,
      error: `fork ${fork.owner}/${fork.repo} not found or inaccessible. Create it manually with 'gh repo fork ${upstreamRepo}' first — this tool does not fork on the caller's behalf.`,
    };
  }

  // The named branch must already be pushed to the fork.
  const branchCheck = ghRunner([
    'api',
    `repos/${fork.owner}/${fork.repo}/branches/${fork.branch}`,
  ]);
  if (branchCheck.status !== 0) {
    return {
      ok: false,
      error: `branch ${fork.branch} not found on fork ${fork.owner}/${fork.repo}. Push the fix branch to the fork before calling this tool.`,
    };
  }

  // Open the PR. --draft and --label are hard-coded; caller args do
  // not control them (guardrails 3 and 4).
  const create = ghRunner([
    'pr',
    'create',
    '--repo',
    upstreamRepo,
    '--head',
    head,
    '--draft',
    '--label',
    AI_GENERATED_LABEL,
    '--title',
    title,
    '--body',
    body,
  ]);
  if (create.status !== 0) {
    return {
      ok: false,
      error: `gh pr create failed: ${create.stderr.trim() || '<no stderr>'}`,
    };
  }

  // gh pr create prints the PR URL to stdout on success.
  const prUrl = create.stdout.trim().split('\n').pop() ?? '';

  return {
    ok: true,
    slug,
    upstream_repo: upstreamRepo,
    head,
    title,
    body,
    labels,
    draft: true,
    dry_run: false,
    command,
    pr_url: prUrl,
  };
}

export const CREATE_FORK_PR_TOOL = {
  name: 'create_fork_pr',
  description:
    "Open a draft PR on the upstream repository from the contributor's already-pushed fork branch. The output side of the round-trip loop — runs after `verify_and_report_fix` has captured `verdicts.unfixed=reproduced` AND `verdicts.fixed=unreproduced`. Conservative by design: `dry_run` defaults to true (returns the gh command without executing); `--draft` and the `ai: generated` label are mandatory; the tool refuses to run unless the round-trip is verified per the current_state's verdicts. The fork branch must already exist on GitHub — this tool does NOT clone, commit, or push on the caller's behalf, and does NOT create the fork (use `gh repo fork` manually first). Pair with `verify_and_report_fix` upstream of this call and with `prepare_fix_candidate` (Layer 1) when registering a fix-candidate spec.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      slug: {
        type: 'string' as const,
        pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
        description:
          "Kebab-case recipe slug (e.g. 'mpmath-983', 'bash-local-shadows-exit'). Must exist in the catalogue.",
      },
      current_state: {
        type: 'object' as const,
        description:
          "Parsed roundtrip.json contents. Must contain `upstream_issue`, `fork` (owner/repo/branch), and `verdicts` with both `unfixed.verdict='reproduced'` and `fixed.verdict='unreproduced'`. The tool refuses to run otherwise.",
        additionalProperties: true,
      },
      pr_title: {
        type: 'string' as const,
        minLength: 1,
        description:
          "PR title. Caller is responsible for following the upstream project's commit / PR title conventions (Conventional Commits, etc.).",
      },
      pr_body: {
        type: 'string' as const,
        description:
          "PR body (Markdown). Defaults to empty. Include a link back to the Vivarium recipe and the upstream issue, and disclose AI authorship per AGENTS.md §4.6 (the `ai: generated` label is applied automatically; surfacing the disclosure in the body is good practice).",
      },
      dry_run: {
        type: 'boolean' as const,
        default: true,
        description:
          'When true (the default), the tool returns the exact `gh pr create` command + a structured summary WITHOUT calling gh. Set to false to actually open the PR. The MCP server never opens an upstream PR by accident.',
      },
    },
    required: ['slug', 'current_state', 'pr_title'],
  },
} as const;
