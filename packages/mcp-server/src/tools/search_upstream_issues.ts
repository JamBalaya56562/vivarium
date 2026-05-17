// Upstream issue search helper. Wraps `gh search issues`. Strict mode
// applies two filters: GitHub's standard `-linked:pr` qualifier (drops
// issues that already have a related PR — these are usually already
// being worked on upstream), and an optional caller-supplied
// `exclude_repos` list (drops matches from repositories the caller
// wants to skip). Permissive mode applies neither and surfaces
// everything for manual triage.
//
// Vivarium ships no built-in exclusion list and no built-in activity
// thresholds. Whether a repository is worth searching, what the
// activity bar is, what counts as a "good" candidate — all of that is
// up to the caller. This tool is a thin convenience over `gh`, not a
// curated policy engine.

import { spawnSync } from 'node:child_process';

export interface SearchUpstreamIssuesArgs {
  project?: string;
  repo?: string;
  query?: string;
  state?: 'open' | 'closed';
  limit?: number;
  selection_policy?: 'strict' | 'permissive';
  labels?: string[];
  exclude_repos?: string[];
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

function normalizeExclusions(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((s) => s.trim()).filter((s) => s.length > 0);
}

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
  const excludeRepos = normalizeExclusions(args.exclude_repos);

  // Whole-repo short-circuit: strict policy + the search repo itself
  // appears in exclude_repos → return empty without paying for gh.
  if (policy === 'strict' && excludeRepos.includes(repo)) {
    return {
      ok: true,
      count: 0,
      repo,
      query: '',
      selection_policy: policy,
      matches: [],
      notes: [
        `repo ${repo} is in the caller-supplied exclude_repos list; strict policy returns no matches. Pass selection_policy='permissive' to override.`,
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
    };
    if (policy === 'strict') m.has_pr = false;
    return m;
  });

  const notes: string[] = [];
  let filtered = matches;
  if (policy === 'strict') {
    const before = matches.length;
    filtered =
      excludeRepos.length > 0
        ? matches.filter((m) => !excludeRepos.includes(m.repo))
        : matches;
    if (filtered.length < before) {
      notes.push(
        `strict policy excluded ${before - filtered.length} match(es) from the caller-supplied exclude_repos list.`,
      );
    }
    notes.push(
      'strict policy: query included `-linked:pr` to exclude issues with related PRs. Any additional filtering (project activity, label conventions, etc.) is the caller’s responsibility.',
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
    "Search an upstream GitHub repository for issues that are candidates for Vivarium reproduction. Thin wrapper over `gh search issues`. Strict mode (default) applies two filters: GitHub's standard `-linked:pr` qualifier (drops issues with related PRs), and a caller-supplied `exclude_repos` list (drops matches whose repo is in that list). Permissive mode applies neither and surfaces everything for manual triage with `has_pr` left unset. Returns the first `limit` matches with body snippets, labels, and `posted_at` so the caller can rank further. This tool ships no built-in exclusion list and no activity thresholds — those are caller decisions.",
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
          "Selection policy. 'strict' (default) appends `-linked:pr` server-side and drops matches whose repo is in `exclude_repos`. 'permissive' surfaces everything for manual triage and leaves has_pr unset.",
      },
      labels: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          "Optional label filter. Each label is passed as `--label <label>` to gh, requiring ALL labels (gh's AND semantics).",
      },
      exclude_repos: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          "Optional list of `owner/repo` strings to exclude in strict mode. The tool itself ships no defaults — pass your own if your workflow has reasons to skip specific projects (e.g. they already operate equivalent tooling internally). Permissive mode ignores this list.",
      },
    },
  },
} as const;
