// Layer-abstracted round-trip verification helper. Computes the
// state-machine next_action from a recipe's current round-trip state
// (passed in via `current_state`, typically the contents of
// src/layer{1,2,3}_*/<slug>/roundtrip.json) and returns the commands
// the round-trip skill should run next. Bridges Path A (Layer 1,
// browser-driven Playwright runs) and Path B (Layer 2/3,
// branch-fix-verdict.yml workflow dispatch) under a single return
// shape so callers do not branch on layer.
//
// Phase 1 (this commit): SCAFFOLDING ONLY. The tool returns the
// canonical roundtrip.json path, the state-machine next_action, and
// the verify_branch_fix-derived deep-link commands. It does NOT execute
// verdict capture or mutate roundtrip.json. Phase 3 will replace the
// command-string return with actual execution for Layer 1
// (Playwright-driven targeted runs) while keeping the same return
// shape for Layer 2/3 (GitHub Actions workflow_dispatch wrapping).

import { getCatalogue } from '../catalogue.js';
import type {
  Layer,
  RoundtripNextAction,
  RoundtripState,
} from '../types.js';
import { verifyBranchFix } from './verify_branch_fix.js';

export interface VerifyAndReportFixArgs {
  slug: string;
  fix_url?: string;
  fix_source?: string;
  branch_image?: string;
  current_state?: Partial<RoundtripState>;
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
// to extract the upstream repo coordinates. The fork repo is the
// contributor's mirror; upstream PRs always target the original owner,
// not the fork. Returns undefined for non-github / malformed URLs.
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

  const next = computeNextAction(args.current_state);
  const verdicts = args.current_state?.verdicts ?? {};
  const roundtripPath = `src/${LAYER_DIRNAME[recipe.layer]}/${slug}/roundtrip.json`;
  const commands = buildCommands({
    next,
    slug,
    layer: recipe.layer,
    pathAB: verifyResult.path,
    compareUrl: verifyResult.compare_url,
    ghCommand: verifyResult.gh_command,
    branchImage: args.branch_image,
    fork: args.current_state?.fork ?? undefined,
    upstreamIssue: args.current_state?.upstream_issue,
  });

  const notes = [...verifyResult.notes];
  notes.push(
    'phase 1 skeleton — verify_and_report_fix returns commands but does not yet execute verdict capture; phase 3 will replace the command return for layer 1 with playwright-driven runs.',
  );

  return {
    ok: true,
    slug: recipe.slug,
    layer: recipe.layer,
    path: verifyResult.path,
    verdicts,
    roundtrip_path: roundtripPath,
    next_action: next,
    commands,
    notes,
  };
}

export const VERIFY_AND_REPORT_FIX_TOOL = {
  name: 'verify_and_report_fix',
  description:
    "Layer-abstracted round-trip verification helper. Computes the state-machine next_action from a recipe's current round-trip state (passed via `current_state`, typically the contents of `src/layer{1,2,3}_*/<slug>/roundtrip.json` against the roundtrip.schema.json shape) and returns the commands the round-trip skill should run next. Bridges Path A (Layer 1, browser-driven Playwright targeted runs) and Path B (Layer 2/3, branch-fix-verdict.yml workflow dispatch) under a single return shape so callers do not branch on layer. The `next_action` enum (`verify_unfixed` → `verify_fixed` → `open_vivarium_pr` → `open_fork_pr` → `complete`) drives the round-trip state machine end-to-end. SCAFFOLDING HELPER as of v0.1.x: the returned `commands[]` are executed by the caller, not by the MCP server. Use `verify_branch_fix` directly when you only need a Path A/B deep-link and not the state-machine layer.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      slug: {
        type: 'string' as const,
        pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
        description:
          "Kebab-case recipe slug (e.g. 'php-12167', 'bash-local-shadows-exit'). Same convention as Manifest v1's `slug`.",
      },
      fix_url: {
        type: 'string' as const,
        description:
          'Public URL of the candidate fix source. Layer 1 only — forwarded to verify_branch_fix to build the Path A `?fix_url=` deep-link. Mutually exclusive with fix_source.',
      },
      fix_source: {
        type: 'string' as const,
        description:
          'Inline candidate fix source. Layer 1 only — forwarded to verify_branch_fix to build the Path A `?fix=<base64>` deep-link. Mutually exclusive with fix_url. Max 4096 bytes.',
      },
      branch_image: {
        type: 'string' as const,
        description:
          "Layer 2/3 only. GHCR tag of the contributor's branch-fix Docker image (e.g. 'ghcr.io/<user>/vivarium-<slug>:fix-issue-<n>'). Surfaced as a comment in the returned commands when present; substituted into the gh workflow run command in Phase 3.",
      },
      current_state: {
        type: 'object' as const,
        description:
          "Current round-trip state for the slug, matching the roundtrip.schema.json shape. Pass the parsed contents of the recipe's roundtrip.json. Omit (or pass {}) for a fresh round-trip — the tool will return `next_action='verify_unfixed'`.",
        additionalProperties: true,
      },
    },
    required: ['slug'],
  },
} as const;
