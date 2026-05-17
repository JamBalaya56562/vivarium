// Scaffolding helper that bundles every artefact an agent needs to
// author a new recipe (validated slug, scaffold + verify commands,
// placeholder facets / projects rows, commit-subject template, next
// steps). The MCP server returns the commands and metadata; the
// agent's shell tool actually invokes mise.

import type { Layer, RoundtripState } from '../types.js';

export interface PrepareNewRecipeArgs {
  project?: string;
  issue?: number;
  title?: string;
  base_image?: string;
  repo_owner?: string;
  layer?: Layer;
}

interface RecipeFacetsRow {
  key: string;
  value: {
    language: string;
    symptom: string;
    severity: string;
    tags: string[];
  };
}

interface ProjectsRow {
  key: string;
  value: {
    display_name: string;
    tagline: string;
    description: string;
    homepage: string;
    github: string;
  };
  note: string;
}

interface PrepareNewRecipeOk {
  ok: true;
  slug: string;
  layer: Layer;
  upstream_issue_url: string;
  scaffold_command: string;
  verify_command: string;
  recipe_facets_row: RecipeFacetsRow;
  projects_row: ProjectsRow;
  commit_subject: string;
  next_steps: string[];
  references: {
    rules: string;
    layer_readme: string;
    selection_policy: string;
  };
  // Initial round-trip state to write into
  // src/layer<N>_*/<slug>/roundtrip.json after scaffolding. Validates
  // against roundtrip.schema.json (schema_version 1). Caller (typically
  // the scaffold-recipe-from-issue skill) is responsible for the write;
  // the MCP server does no filesystem mutation itself.
  roundtrip_init: RoundtripState;
  roundtrip_path: string;
}

interface PrepareNewRecipeError {
  ok: false;
  error: string;
}

export type PrepareNewRecipeResult =
  | PrepareNewRecipeOk
  | PrepareNewRecipeError;

// Same regex as parseSlug() in docs/scripts/generate-recipes-index.ts.
// Single-sourced as a literal here because the MCP package is published
// independently and cannot import from docs/.
const SLUG_REGEX = /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*?)-(\d+)$/;

// Mirror of LAYER_DIRNAME in verify_and_report_fix — keep in sync.
const LAYER_DIRNAME: Record<Layer, string> = {
  1: 'layer1_wasm',
  2: 'layer2_docker',
  3: 'layer3_thirdway',
};

// Default upstream owner/repo for common projects, mirroring the lookup
// in docs/scripts/new-recipe.ts. Override via repo_owner.
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

// Layer scope conventions: feat(wasm) for Layer 1, feat(layer2) for
// Layer 2, feat(layer3) for Layer 3 — established by PRs #92/#94/#98/
// #194 (Layer 2), #180/#189/#192 (Layer 1 = wasm), #106 (Layer 3).
function commitScopeFor(layer: Layer): string {
  switch (layer) {
    case 1:
      return 'wasm';
    case 2:
      return 'layer2';
    case 3:
      return 'layer3';
  }
}

function defaultRepoFor(project: string): string {
  return DEFAULT_REPO[project] ?? `${project}/${project}`;
}

export async function prepareNewRecipe(
  args: PrepareNewRecipeArgs,
): Promise<PrepareNewRecipeResult> {
  const project = (args.project ?? '').trim();
  const issueNum = args.issue;
  const title = (args.title ?? '').trim();
  const layer: Layer = args.layer ?? 2;

  if (!project) return { ok: false, error: 'project is required' };
  if (issueNum === undefined || issueNum === null)
    return { ok: false, error: 'issue is required' };
  if (!Number.isInteger(issueNum) || issueNum <= 0)
    return { ok: false, error: `issue must be a positive integer (got ${issueNum})` };
  if (!title) return { ok: false, error: 'title is required' };
  if (![1, 2, 3].includes(layer))
    return { ok: false, error: `layer must be 1, 2, or 3 (got ${layer})` };

  const slug = `${project}-${issueNum}`;
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      error:
        `generated slug "${slug}" is not parseable by ` +
        `docs/scripts/generate-recipes-index.ts. project must be ` +
        `kebab-case ([a-z][a-z0-9]*(-[a-z][a-z0-9]*)*) and contain no ` +
        `trailing digits.`,
    };
  }

  const ownerRepo = (args.repo_owner ?? defaultRepoFor(project)).trim();
  const upstreamIssueUrl = `https://github.com/${ownerRepo}/issues/${issueNum}`;

  // Layer 2 has the canonical scaffolder today (mise run recipes:new).
  // Layer 1 / 3 scaffolders do not yet exist — for those, the agent
  // copies from an existing recipe; we still return scaffolding intent.
  const baseFlag = args.base_image
    ? ` --base "${args.base_image}"`
    : '';
  const repoFlag =
    args.repo_owner && args.repo_owner !== defaultRepoFor(project)
      ? ` --repo ${args.repo_owner}`
      : '';
  const scaffoldCommand =
    layer === 2
      ? `mise run recipes:new -- ${project} ${issueNum} "${title}"${baseFlag}${repoFlag}`
      : `# No scaffolder for Layer ${layer} yet — copy from an existing src/layer${layer}_*/ recipe and adapt.`;
  const verifyCommand =
    layer === 2
      ? `mise run recipes:verify -- ${slug}`
      : `# No verifier for Layer ${layer} yet — see src/layer${layer}_*/README.md for per-layer validation.`;

  const recipeFacetsRow: RecipeFacetsRow = {
    key: slug,
    value: {
      language: 'TODO-fill-in',
      symptom: 'TODO-fill-in',
      severity: 'TODO-fill-in',
      tags: [],
    },
  };

  const projectsRow: ProjectsRow = {
    key: project,
    value: {
      display_name: project,
      tagline: 'TODO-fill-in',
      description: 'TODO-fill-in',
      homepage: '',
      github: `https://github.com/${ownerRepo}`,
    },
    note: `Only add this row to docs/site/_data/projects.json if "${project}" is a new project (i.e. no existing recipe under src/layer*_*/${project}-*/).`,
  };

  const commitSubject = `feat(${commitScopeFor(layer)}): ${slug} reproduction (...)`;

  const nextSteps =
    layer === 2
      ? [
          `Run: ${scaffoldCommand}`,
          `Edit src/layer2_docker/${slug}/Dockerfile — set the real base image.`,
          `Edit src/layer2_docker/${slug}/repro.sh — replace the TODO stub with the real probe.`,
          `Edit src/layer2_docker/${slug}/README.md — fill in bug description, verdict contract, references.`,
          `Edit src/layer2_docker/${slug}/index.html — fill in the lede.`,
          `Add the recipe_facets_row to docs/site/_data/recipe-facets.json with real values.`,
          `If "${project}" is a new project, add the projects_row to docs/site/_data/projects.json.`,
          `Run: ${verifyCommand}  (this regenerates indices, runs lint, runs the docker build/run, and the rspress build).`,
          `Commit with subject: ${commitSubject}`,
          `Submit the PR.`,
        ]
      : [
          `Copy from an existing recipe under src/layer${layer}_*/ — the canonical authoring reference.`,
          `Add the recipe_facets_row to docs/site/_data/recipe-facets.json with real values.`,
          `If "${project}" is a new project, add the projects_row to docs/site/_data/projects.json.`,
          `Run: cd docs && mise exec -- bun run generate`,
          `Validate locally per the layer's README + the .claude/rules/recipe-authoring.md checklist.`,
          `Commit with subject: ${commitSubject}`,
          `Submit the PR.`,
        ];

  const roundtripInit: RoundtripState = {
    schema_version: 1,
    slug,
    upstream_issue: upstreamIssueUrl,
    status: 'draft',
    updated_at: new Date().toISOString(),
    notes: ['scaffolded from upstream issue'],
  };
  const roundtripPath = `src/${LAYER_DIRNAME[layer]}/${slug}/roundtrip.json`;

  return {
    ok: true,
    slug,
    layer,
    upstream_issue_url: upstreamIssueUrl,
    scaffold_command: scaffoldCommand,
    verify_command: verifyCommand,
    recipe_facets_row: recipeFacetsRow,
    projects_row: projectsRow,
    commit_subject: commitSubject,
    next_steps: nextSteps,
    references: {
      rules:
        'https://github.com/aletheia-works/vivarium/blob/main/.claude/rules/recipe-authoring.md',
      layer_readme: `https://github.com/aletheia-works/vivarium/blob/main/src/layer${layer}_${layer === 1 ? 'wasm' : layer === 2 ? 'docker' : 'thirdway'}/README.md`,
      selection_policy:
        'https://github.com/aletheia-works/vivarium (issue selection policy is in _context/strategy/issue_selection_policy.md, gitignored)',
    },
    roundtrip_init: roundtripInit,
    roundtrip_path: roundtripPath,
  };
}

export const PREPARE_NEW_RECIPE_TOOL = {
  name: 'prepare_new_recipe',
  description:
    "Prepare everything an AI agent needs to author a new Vivarium recipe for a given upstream project + issue. SCAFFOLDING HELPER, not an execution engine — returns the exact `mise run recipes:new` and `mise run recipes:verify` commands the agent should run, plus placeholder rows for docs/site/_data/recipe-facets.json and (if the project is new) docs/site/_data/projects.json, plus a commit-subject template and a sequenced next-steps checklist. Validates the slug at call time against the same regex `docs/scripts/generate-recipes-index.ts` uses, so unparseable slugs are rejected before any work begins. Use this immediately after picking an issue from `gh search`; pair with `match_error` / `list_recipes` if you need to confirm no existing recipe already covers the bug.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: {
        type: 'string' as const,
        pattern: '^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$',
        description:
          "Upstream project name in kebab-case (e.g. 'node', 'cpython', 'typescript'). Must not contain trailing digits — those would confuse the slug parser.",
      },
      issue: {
        type: 'integer' as const,
        minimum: 1,
        description:
          'Upstream issue number (positive integer, e.g. 63041 for nodejs/node#63041).',
      },
      title: {
        type: 'string' as const,
        description:
          "One-line bug title (e.g. \"Intl.DateTimeFormat drops month with calendar:'iso8601'\"). Used in the scaffold command and as the recipe README's H1.",
      },
      base_image: {
        type: 'string' as const,
        description:
          "Optional Docker base image for Layer 2 recipes (e.g. 'node:26-slim'). Forwarded to `mise run recipes:new -- ... --base <image>`. Layer 1 / 3 ignore this.",
      },
      repo_owner: {
        type: 'string' as const,
        description:
          "Optional upstream owner/repo override (e.g. 'microsoft/TypeScript'). Defaults to a heuristic per project name: 'node' → 'nodejs/node', 'cpython' → 'python/cpython', etc. Only forward to the scaffold command when it differs from the heuristic.",
      },
      layer: {
        type: 'integer' as const,
        enum: [1, 2, 3],
        default: 2,
        description:
          'Vivarium layer: 1=WASM (in-browser), 2=Docker (default), 3=record-replay (rr). The commit scope, scaffold command, and next-steps tailor to the layer.',
      },
    },
    required: ['project', 'issue', 'title'],
  },
} as const;
