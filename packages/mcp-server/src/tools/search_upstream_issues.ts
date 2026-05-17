// Upstream issue search helper. Wraps `gh search issues` and applies
// the project's strict selection policy (`-linked:pr` qualifier server-
// side, repro-bot repos excluded client-side). Project-level activity
// filter (§6 of issue_selection_policy.md: 90-day human-merge ≥ 5) is
// deliberately NOT enforced here — it is a project-scope concern,
// expensive to compute per issue, and best handled in the
// scaffold-recipe-from-issue skill before the search runs.
//
// Phase 2 of the round-trip automation plan. Pair with prepare_new_recipe
// to scaffold the recipe directory + initial roundtrip.json.

import { spawnSync } from 'node:child_process';

export interface SearchUpstreamIssuesArgs {
  project?: string;
  repo?: string;
  query?: string;
  state?: 'open' | 'closed';
  limit?: number;
  selection_policy?: 'strict' | 'permissive';
  labels?: string[];
}

export interface SearchMatch {
  repo: string;
  number: number;
  title: string;
  url: string;
  body_snippet: string;
  posted_at: string;
  labels: string[];
  state: string;
  // strict mode: always false (guaranteed by `-linked:pr` query qualifier).
  // permissive mode: omitted (computing this per issue would require an
  // extra `gh issue view --json linkedPullRequests` round-trip per match;
  // callers that need it should issue that query themselves).
  has_pr?: boolean;
  has_repro_bot: boolean;
}

interface SearchUpstreamIssuesOk {
  ok: true;
  count: number;
  repo: string;
  query: string;
  selection_policy: 'strict' | 'permissive';
  matches: SearchMatch[];
  notes: string[];
}

interface SearchUpstreamIssuesError {
  ok: false;
  error: string;
}

export type SearchUpstreamIssuesResult =
  | SearchUpstreamIssuesOk
  | SearchUpstreamIssuesError;

// Mirror of DEFAULT_REPO in prepare_new_recipe.ts — keep in sync. Lifted
// to module scope so both tools resolve project → repo identically.
const DEFAULT_REPO: Record<string, string> = {
  node: 'nodejs/node',
  cpython: 'python/cpython',
  typescript: 'microsoft/TypeScript',
  rust: 'rust-lang/rust',
  pandas: 'pandas-dev/pandas',
  numpy: 'numpy/numpy',
  php: 'php/php-src',
  ruby: 'ruby/ruby',
  regex: 'rust-lang/regex',
};

// Repos that operate an in-house reproduction bot (issue_selection_policy
// §4). Strict policy excludes them entirely; permissive policy surfaces
// them with `has_repro_bot: true` so the caller can decide.
//
// Discovered as of 2026-05-17: oven-sh/bun (per Bun docs and policy memo).
// Append additions discovered during routine searches.
const REPRO_BOT_REPOS: ReadonlyArray<string> = ['oven-sh/bun'];

function defaultRepoFor(project: string): string {
  return DEFAULT_REPO[project] ?? `${project}/${project}`;
}

// Injectable for unit tests. Returns { status, stdout, stderr } so the
// real impl and any stub agree on the contract — we never expose the
// raw spawn result.
export interface GhRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type GhRunner = (args: string[]) => GhRunResult;

const defaultGhRunner: GhRunner = (args) => {
  const r = spawnSync('gh', args, { encoding: 'utf-8' });
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

interface GhSearchIssue {
  number: number;
  title: string;
  url: string;
  body?: string;
  labels?: Array<{ name?: string }>;
  createdAt?: string;
  state?: string;
  repository?: { nameWithOwner?: string };
}

const BODY_SNIPPET_LIMIT = 500;

export async function searchUpstreamIssues(
  args: SearchUpstreamIssuesArgs,
): Promise<SearchUpstreamIssuesResult> {
  let repo = args.repo?.trim();
  if (!repo) {
    const project = args.project?.trim();
    if (!project) {
      return { ok: false, error: 'either project or repo is required' };
    }
    repo = defaultRepoFor(project);
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return {
      ok: false,
      error: `repo must be of the form owner/repo (got "${repo}")`,
    };
  }

  const state = args.state ?? 'open';
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const policy = args.selection_policy ?? 'strict';

  // Whole-repo short-circuit: strict policy excludes repro-bot repos
  // entirely (issue_selection_policy §4) without paying for the gh call.
  if (policy === 'strict' && REPRO_BOT_REPOS.includes(repo)) {
    return {
      ok: true,
      count: 0,
      repo,
      query: '',
      selection_policy: policy,
      matches: [],
      notes: [
        `repo ${repo} maintains an in-house reproduction bot; strict selection policy excludes the entire project (selection_policy.md §4). Pass selection_policy='permissive' to override.`,
      ],
    };
  }

  const queryParts: string[] = [];
  if (args.query?.trim()) queryParts.push(args.query.trim());
  if (policy === 'strict') queryParts.push('-linked:pr');
  const queryString = queryParts.join(' ');

  const ghArgs = [
    'search',
    'issues',
    '--repo',
    repo,
    '--state',
    state,
    '--limit',
    String(limit),
    '--json',
    'number,title,url,body,labels,createdAt,state,repository',
  ];
  if (Array.isArray(args.labels)) {
    for (const label of args.labels) {
      if (label.trim()) ghArgs.push('--label', label.trim());
    }
  }
  if (queryString) ghArgs.push(queryString);

  let result: GhRunResult;
  try {
    result = ghRunner(ghArgs);
  } catch (err) {
    return {
      ok: false,
      error: `failed to spawn gh: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    return {
      ok: false,
      error: `gh exit ${result.status}: ${stderr || '<no stderr>'}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    return {
      ok: false,
      error: `failed to parse gh JSON output: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: `gh JSON output is not an array (got ${typeof parsed})`,
    };
  }

  const issues = parsed as GhSearchIssue[];
  const matches: SearchMatch[] = issues.map((item) => {
    const itemRepo = item.repository?.nameWithOwner ?? repo;
    const m: SearchMatch = {
      repo: itemRepo,
      number: item.number,
      title: item.title,
      url: item.url,
      body_snippet: (item.body ?? '').slice(0, BODY_SNIPPET_LIMIT),
      posted_at: item.createdAt ?? '',
      labels: (item.labels ?? [])
        .map((l) => l.name ?? '')
        .filter((n) => n.length > 0),
      state: item.state ?? state,
      has_repro_bot: REPRO_BOT_REPOS.includes(itemRepo),
    };
    if (policy === 'strict') m.has_pr = false;
    return m;
  });

  const notes: string[] = [];
  let filtered = matches;
  if (policy === 'strict') {
    const before = matches.length;
    filtered = matches.filter((m) => !m.has_repro_bot);
    if (filtered.length < before) {
      notes.push(
        `strict policy excluded ${before - filtered.length} match(es) from in-house repro-bot repos (${REPRO_BOT_REPOS.join(', ')}).`,
      );
    }
    notes.push(
      "strict policy: query included `-linked:pr` to exclude issues with related PRs. project activity (selection_policy.md §6) is NOT checked here — verify the 90-day human-merge count separately before authoring.",
    );
  }

  return {
    ok: true,
    count: filtered.length,
    repo,
    query: queryString,
    selection_policy: policy,
    matches: filtered,
    notes,
  };
}

export const SEARCH_UPSTREAM_ISSUES_TOOL = {
  name: 'search_upstream_issues',
  description:
    "Search an upstream GitHub repository for issues that are candidates for Vivarium reproduction. Wraps `gh search issues` and applies the project's strict selection policy server-side: by default the query includes the `-linked:pr` qualifier so issues with related PRs never reach the result set (selection_policy.md §2), and known repro-bot repos like oven-sh/bun are excluded (§4). Returns the first `limit` matches with body snippets, labels, and `posted_at` so the caller can rank further. Project-level activity filter (§6, 90-day human-merge ≥ 5) is NOT enforced here — that check is repo-scope, not issue-scope; surface it from the calling skill before invoking this tool. Pair with `prepare_new_recipe` once a candidate is chosen.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: {
        type: 'string' as const,
        pattern: '^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$',
        description:
          "Kebab-case project name (e.g. 'node', 'cpython'). Resolves to a default owner/repo via the same map used by prepare_new_recipe. Either project or repo must be supplied.",
      },
      repo: {
        type: 'string' as const,
        description:
          "Full upstream `owner/repo` (e.g. 'nodejs/node'). Overrides the project's default mapping when both are passed. Either project or repo must be supplied.",
      },
      query: {
        type: 'string' as const,
        description:
          "Optional extra search query appended to the gh search invocation (e.g. 'in:title parser', 'comments:>5'). Combined with the policy's automatic qualifiers.",
      },
      state: {
        type: 'string' as const,
        enum: ['open', 'closed'],
        default: 'open',
        description:
          'Issue state. Defaults to open since closed issues are usually already resolved upstream.',
      },
      limit: {
        type: 'integer' as const,
        minimum: 1,
        maximum: 50,
        default: 10,
        description: 'Maximum number of matches to return. Clamped to [1, 50].',
      },
      selection_policy: {
        type: 'string' as const,
        enum: ['strict', 'permissive'],
        default: 'strict',
        description:
          "Selection policy. 'strict' (default) applies `-linked:pr` server-side and drops repro-bot repos; 'permissive' surfaces everything for manual triage but leaves has_pr unset (caller must check per-issue).",
      },
      labels: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          "Optional label filter. Each label is passed as `--label <label>` to gh, requiring ALL labels (gh's AND semantics).",
      },
    },
  },
} as const;
