// Layer-abstracted round-trip verification helper. Computes the
// state-machine next_action from a recipe's current round-trip state,
// optionally executes the appropriate verdict capture (Layer 1
// Playwright run or Layer 2/3 workflow dispatch), and returns the
// merged state alongside the commands the caller should run for any
// non-executing action (open PRs, manual intervention, complete).
//
// Phase 3: when `auto_execute` is true (the default), the tool
// actually runs `verify_unfixed` / `verify_fixed` via the internal
// `run_layer1_verdict` / `run_layer23_verdict` helpers and merges the
// captured verdict into the response's `verdicts` field. Pass
// `auto_execute: false` to get the Phase 1 / 2 behaviour (return
// commands as strings without running anything).

import { getCatalogue } from '../catalogue.js';
import type {
  Layer,
  RoundtripNextAction,
  RoundtripState,
  RoundtripVerdict,
  VerdictSource,
} from '../types.js';
import {
  runLayer1Verdict,
  type RunLayer1VerdictResult,
} from './run_layer1_verdict.js';
import {
  runLayer23Verdict,
  type RunLayer23VerdictResult,
} from './run_layer23_verdict.js';
import { verifyBranchFix } from './verify_branch_fix.js';

export interface VerifyAndReportFixArgs {
  slug: string;
  fix_url?: string;
  fix_source?: string;
  branch_image?: string;
  current_state?: Partial<RoundtripState>;
  // Phase 3 additions:
  auto_execute?: boolean;
  workspace_path?: string;
  poll_interval_ms?: number;
  poll_timeout_ms?: number;
}

export interface ExecutedInfo {
  action: 'verify_unfixed' | 'verify_fixed';
  source: VerdictSource;
  ok: boolean;
  duration_ms: number;
  error?: string;
  workflow_run_id?: number;
}

export interface VerifyAndReportFixOk {
  ok: true;
  slug: string;
  layer: Layer;
  path: 'A' | 'B';
  verdicts: NonNullable<RoundtripState['verdicts']>;
  roundtrip_path: string;
  next_action: RoundtripNextAction;
  commands: string[];
  notes: string[];
  executed?: ExecutedInfo;
}

export interface VerifyAndReportFixError {
  ok: false;
  error: string;
}

export type VerifyAndReportFixResult =
  | VerifyAndReportFixOk
  | VerifyAndReportFixError;

const LAYER_DIRNAME: Record<Layer, string> = {
  1: 'layer1_wasm',
  2: 'layer2_docker',
  3: 'layer3_thirdway',
};

const LAYER_SOURCE: Record<Layer, VerdictSource> = {
  1: 'layer1-headless',
  2: 'layer2-ghcr',
  3: 'layer3-trace',
};

// Pure state-machine transition. Exported so unit tests and any future
// MCP client can reuse the same logic without re-implementing the
// transitions. `status: blocked` short-circuits to manual_intervention
// regardless of verdict / PR fields so a paused round-trip cannot drift
// further on automation.
export function computeNextAction(
  state: Partial<RoundtripState> | undefined,
): RoundtripNextAction {
  if (!state) return 'verify_unfixed';

  if (state.status === 'blocked') return 'manual_intervention';
  if (state.status === 'merged') return 'complete';
  if (state.upstream_pr) return 'complete';

  const unfixed = state.verdicts?.unfixed;
  const fixed = state.verdicts?.fixed;
  const verified =
    unfixed?.verdict === 'reproduced' && fixed?.verdict === 'unreproduced';

  if (verified) {
    if (!state.vivarium_pr) return 'open_vivarium_pr';
    return 'open_fork_pr';
  }
  if (unfixed?.verdict === 'reproduced') return 'verify_fixed';
  return 'verify_unfixed';
}

// Parse `https://github.com/<owner>/<repo>/issues/<n>` (or `/pull/<n>`)
// to extract the upstream repo coordinates.
export function parseUpstreamIssue(
  url: string | undefined,
): { owner: string; repo: string } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return undefined;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return undefined;
    if (parts[2] !== 'issues' && parts[2] !== 'pull') return undefined;
    return { owner: parts[0]!, repo: parts[1]! };
  } catch {
    return undefined;
  }
}

interface BuildCommandsArgs {
  next: RoundtripNextAction;
  slug: string;
  layer: Layer;
  pathAB: 'A' | 'B';
  compareUrl: string;
  ghCommand?: string;
  branchImage?: string;
  fork?: RoundtripState['fork'];
  upstreamIssue?: string;
}

function buildCommands(args: BuildCommandsArgs): string[] {
  const {
    next,
    slug,
    layer,
    pathAB,
    compareUrl,
    ghCommand,
    branchImage,
    fork,
    upstreamIssue,
  } = args;
  switch (next) {
    case 'verify_unfixed':
      if (pathAB === 'A') {
        return [
          `# Capture the unfixed verdict against the upstream-as-shipped runtime.`,
          `bun x playwright test --grep ${slug}`,
          `# Or inspect the verdict visually at ${compareUrl}.`,
        ];
      }
      return [
        `# Capture the unfixed verdict by running the recipe's Docker image as-published.`,
        `mise run recipes:verify ${slug}`,
      ];
    case 'verify_fixed':
      if (pathAB === 'A') {
        return [
          `# Capture the fixed verdict against the candidate fix source.`,
          `PLAYWRIGHT_FIX_URL='<fix-url>' bun x playwright test --grep ${slug}`,
          `# Or open ${compareUrl} in a browser; the fix is pre-loaded via ?fix_url= / ?fix=<base64>.`,
        ];
      }
      return [
        `# Build and push the branch-fix Docker image, then dispatch the verdict workflow.`,
        branchImage
          ? `# Using branch_image=${branchImage}`
          : `# Substitute <your-image-ref> with the GHCR tag of your branch-fix image.`,
        ghCommand ??
          `gh workflow run branch-fix-verdict.yml --repo aletheia-works/vivarium -f slug=${slug} -f branch_image=<your-image-ref>`,
      ];
    case 'open_fork_pr': {
      if (!fork) {
        return [
          `# Populate roundtrip.json#/fork (owner / repo / branch) before opening the upstream PR.`,
        ];
      }
      const upstream = parseUpstreamIssue(upstreamIssue);
      if (!upstream) {
        return [
          `# Cannot derive upstream repo from roundtrip.json#/upstream_issue ('${upstreamIssue ?? 'missing'}').`,
          `# Expected form: https://github.com/<owner>/<repo>/issues/<n>.`,
        ];
      }
      return [
        `# Open the upstream PR in draft mode (AI agents must keep it --draft per round-trip guardrail 4).`,
        `# Base repo = upstream (${upstream.owner}/${upstream.repo}); head = contributor fork (${fork.owner}:${fork.branch}).`,
        `gh pr create --repo ${upstream.owner}/${upstream.repo} --head ${fork.owner}:${fork.branch} --draft --label 'ai: generated' --title '<title>' --body '<body>'`,
      ];
    }
    case 'open_vivarium_pr':
      return [
        `# Submit the Vivarium-side PR carrying the recipe and roundtrip.json update.`,
        `sl addremove`,
        `sl commit -m 'feat(layer${layer}): ${slug} — round-trip verdicts captured'`,
        `sl pr submit`,
      ];
    case 'manual_intervention':
      return [
        `# status=blocked: round-trip paused for manual review.`,
        `# Inspect roundtrip.json#/notes for the reason and resolve before resuming automation.`,
      ];
    case 'complete':
      return [];
  }
}

// Layer 1 verdict capture path. fix_url is required when action is
// verify_fixed (the whole point of "fixed" is to substitute a fix).
async function executeLayer1(
  slug: string,
  action: 'verify_unfixed' | 'verify_fixed',
  args: VerifyAndReportFixArgs,
): Promise<{
  verdictEntry?: RoundtripVerdict;
  executed: ExecutedInfo;
}> {
  if (action === 'verify_fixed' && !args.fix_url) {
    return {
      executed: {
        action,
        source: 'layer1-headless',
        ok: false,
        duration_ms: 0,
        error: 'fix_url is required for verify_fixed on Layer 1 recipes',
      },
    };
  }

  const result: RunLayer1VerdictResult = await runLayer1Verdict({
    slug,
    fix_url: action === 'verify_fixed' ? args.fix_url : undefined,
    workspace_path: args.workspace_path,
  });

  if (!result.ok) {
    return {
      executed: {
        action,
        source: 'layer1-headless',
        ok: false,
        duration_ms: result.duration_ms,
        error: result.error,
      },
    };
  }

  const verdictEntry: RoundtripVerdict = {
    verdict: result.verdict,
    captured_at: result.captured_at,
    source: 'layer1-headless',
  };
  return {
    verdictEntry,
    executed: {
      action,
      source: 'layer1-headless',
      ok: true,
      duration_ms: result.duration_ms,
    },
  };
}

// Layer 2/3 verdict capture path. verify_fixed needs branch_image;
// verify_unfixed reads the deployed verdict.json snapshot.
async function executeLayer23(
  slug: string,
  layer: 2 | 3,
  action: 'verify_unfixed' | 'verify_fixed',
  args: VerifyAndReportFixArgs,
): Promise<{
  verdictEntry?: RoundtripVerdict;
  executed: ExecutedInfo;
}> {
  const sourceLabel = LAYER_SOURCE[layer];

  if (action === 'verify_fixed' && !args.branch_image) {
    return {
      executed: {
        action,
        source: sourceLabel,
        ok: false,
        duration_ms: 0,
        error: 'branch_image is required for verify_fixed on Layer 2/3 recipes',
      },
    };
  }

  const mode = action === 'verify_unfixed' ? 'unfixed' : 'fixed';
  const result: RunLayer23VerdictResult = await runLayer23Verdict({
    slug,
    mode,
    branch_image: args.branch_image,
    expected_verdict: mode === 'fixed' ? 'unreproduced' : undefined,
    poll_interval_ms: args.poll_interval_ms,
    poll_timeout_ms: args.poll_timeout_ms,
  });

  if (!result.ok) {
    return {
      executed: {
        action,
        source: sourceLabel,
        ok: false,
        duration_ms: result.duration_ms,
        error: result.error,
        workflow_run_id: result.workflow_run_id,
      },
    };
  }

  const verdictEntry: RoundtripVerdict = {
    verdict: result.verdict,
    captured_at: result.captured_at,
    source: sourceLabel,
  };
  return {
    verdictEntry,
    executed: {
      action,
      source: sourceLabel,
      ok: true,
      duration_ms: result.duration_ms,
      workflow_run_id: result.workflow_run_id,
    },
  };
}

export async function verifyAndReportFix(
  args: VerifyAndReportFixArgs,
): Promise<VerifyAndReportFixResult> {
  const slug = args.slug?.trim();
  if (!slug) {
    return { ok: false, error: 'missing required argument: slug' };
  }

  const { recipes } = await getCatalogue();
  const recipe = recipes.find((r) => r.slug === slug);
  if (!recipe) {
    return { ok: false, error: `recipe not found: ${slug}` };
  }

  const verifyResult = await verifyBranchFix({
    slug,
    fix_url: args.fix_url,
    fix_source: args.fix_source,
  });
  if (!verifyResult.ok) {
    return { ok: false, error: verifyResult.error };
  }

  const initialNext = computeNextAction(args.current_state);
  const verdicts: NonNullable<RoundtripState['verdicts']> = {
    ...(args.current_state?.verdicts ?? {}),
  };

  const notes = [...verifyResult.notes];
  let executed: ExecutedInfo | undefined;

  // Auto-execute defaults to true. Only verify_unfixed / verify_fixed
  // are executable; the other next_actions (open_*_pr,
  // manual_intervention, complete) are caller actions.
  const autoExecute = args.auto_execute !== false;
  const shouldExecute =
    autoExecute &&
    (initialNext === 'verify_unfixed' || initialNext === 'verify_fixed');

  if (shouldExecute) {
    const executable = initialNext as 'verify_unfixed' | 'verify_fixed';
    const captured =
      recipe.layer === 1
        ? await executeLayer1(slug, executable, args)
        : await executeLayer23(slug, recipe.layer as 2 | 3, executable, args);

    executed = captured.executed;
    if (captured.verdictEntry) {
      if (executable === 'verify_unfixed') {
        verdicts.unfixed = captured.verdictEntry;
      } else {
        verdicts.fixed = captured.verdictEntry;
      }
    }
    if (!captured.executed.ok) {
      notes.push(
        `auto-execute of ${executable} failed: ${captured.executed.error ?? '<no error message>'}`,
      );
    }
  } else if (!autoExecute) {
    notes.push(
      'auto_execute=false: returning command scaffolding without running verdict capture.',
    );
  }

  // Recompute next_action against the (possibly updated) verdicts so
  // the caller sees what to do next now that a verdict was captured.
  const updatedState: Partial<RoundtripState> = {
    ...args.current_state,
    verdicts,
  };
  const nextAction = computeNextAction(updatedState);

  const roundtripPath = `src/${LAYER_DIRNAME[recipe.layer]}/${slug}/roundtrip.json`;
  const commands = buildCommands({
    next: nextAction,
    slug,
    layer: recipe.layer,
    pathAB: verifyResult.path,
    compareUrl: verifyResult.compare_url,
    ghCommand: verifyResult.gh_command,
    branchImage: args.branch_image,
    fork: args.current_state?.fork ?? undefined,
    upstreamIssue: args.current_state?.upstream_issue,
  });

  return {
    ok: true,
    slug: recipe.slug,
    layer: recipe.layer,
    path: verifyResult.path,
    verdicts,
    roundtrip_path: roundtripPath,
    next_action: nextAction,
    commands,
    notes,
    ...(executed ? { executed } : {}),
  };
}

export const VERIFY_AND_REPORT_FIX_TOOL = {
  name: 'verify_and_report_fix',
  description:
    "Layer-abstracted round-trip verification driver. Computes the state-machine next_action from the recipe's current round-trip state and, when `auto_execute` is true (the default), runs the appropriate verdict capture: a Playwright `--grep` targeted run for Layer 1 or a `gh workflow run branch-fix-verdict.yml` dispatch + artefact download for Layer 2/3. Returns the merged state with any captured verdict in `verdicts`, the next state-machine action in `next_action`, and the commands to run for any non-executing action (PR opens, manual intervention, complete) in `commands`. Pass `auto_execute: false` for the earlier Phase 1 / 2 behaviour (return commands without running anything). The `executed` field reports the action that just ran, its source, and any error.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      slug: {
        type: 'string' as const,
        pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
        description:
          "Kebab-case recipe slug (e.g. 'php-12167', 'bash-local-shadows-exit').",
      },
      fix_url: {
        type: 'string' as const,
        description:
          'Public URL of the candidate fix source. Layer 1 only — injected as `?fix_url=` when capturing the fixed verdict. Required for verify_fixed on Layer 1.',
      },
      fix_source: {
        type: 'string' as const,
        description:
          'Inline candidate fix source. Layer 1 only — surfaced in the returned `compare_url` for visual inspection; not used by Phase 3 auto-execute (`fix_url` is the executable input).',
      },
      branch_image: {
        type: 'string' as const,
        description:
          "Layer 2/3 only. GHCR tag of the contributor's branch-fix Docker image. Required for verify_fixed on Layer 2/3 — passed as the `branch_image` input to `branch-fix-verdict.yml`.",
      },
      current_state: {
        type: 'object' as const,
        description:
          "Current round-trip state for the slug, matching roundtrip.schema.json. Pass the parsed contents of the recipe's roundtrip.json. Omit for a fresh round-trip — the tool will compute `verify_unfixed` and (with auto_execute) run it.",
        additionalProperties: true,
      },
      auto_execute: {
        type: 'boolean' as const,
        default: true,
        description:
          'Whether to actually run the verify_unfixed / verify_fixed action when the state machine selects one. Defaults to true. Set false to preserve the Phase 1 / 2 behaviour of returning commands without running anything.',
      },
      workspace_path: {
        type: 'string' as const,
        description:
          'Layer 1 only. Filesystem path to the `src/layer1_wasm/` workspace (where Playwright config lives). Defaults to the monorepo-relative path `src/layer1_wasm`. Pass an absolute path if the MCP server is launched from elsewhere.',
      },
      poll_interval_ms: {
        type: 'integer' as const,
        minimum: 1000,
        description:
          'Layer 2/3 only. Interval between `gh run view` polls when waiting for branch-fix-verdict.yml to complete. Default 15000ms.',
      },
      poll_timeout_ms: {
        type: 'integer' as const,
        minimum: 1000,
        description:
          'Layer 2/3 only. Hard cap on the total wait for the workflow to complete. Default 600000ms (10 minutes).',
      },
    },
    required: ['slug'],
  },
} as const;
