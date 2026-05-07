// Phase 7 B3 — verify_branch_fix tool (5th MCP tool, ADR-0030).
//
// A scaffolding helper, NOT an execution engine. Stdio TypeScript can't
// run php-wasm / pyodide (ADR-0019 §F rejected the headless-browser
// dependency). The tool's job is to give the agent a deep-link URL plus
// instructions, leaving execution to the visitor's browser (or to a
// browser MCP the agent separately drives).
//
// Layer dispatch:
//   - Layer 1 → path A. compare_url is the recipe page itself with
//     `?fix_url=` or `?fix=<base64url>` so the visitor's browser does
//     the run. Path A produces a verdict bundle the visitor drops on
//     /repro/compare.
//   - Layer 2/3 → path B. compare_url is /repro/compare with `?slug=`
//     and `?branch_url=` placeholders; gh_command is the
//     `branch-fix-verdict.yml` workflow_dispatch line the agent runs.

import { getCatalogue } from '../catalogue.js';
import type { Layer, RecipeEntry } from '../types.js';

export interface VerifyBranchFixArgs {
  slug: string;
  fix_url?: string;
  fix_source?: string;
}

interface VerifyBranchFixOk {
  ok: true;
  slug: string;
  layer: Layer;
  path: 'A' | 'B';
  page_url: string;
  compare_url: string;
  gh_command?: string;
  instructions: string;
  notes: string[];
}

interface VerifyBranchFixError {
  ok: false;
  error: string;
}

export type VerifyBranchFixResult = VerifyBranchFixOk | VerifyBranchFixError;

const FIX_INLINE_LIMIT_BYTES = 4 * 1024;

const PIPELINE_DOC_URL =
  'https://aletheia-works.github.io/vivarium/spec/branch-fix-pipeline';
const D5_DOC_URL_EN =
  'https://aletheia-works.github.io/vivarium/guide/compare-branch-fix';
const D5_DOC_URL_JA =
  'https://aletheia-works.github.io/vivarium/ja/guide/compare-branch-fix';

/* ------------------------------------------------------------------------ */
/* base64url (encode is sync; decode in Path A's panel)                     */
/* ------------------------------------------------------------------------ */

function base64UrlEncode(text: string): string {
  // Use TextEncoder + manual base64 to preserve UTF-8 semantics; Node's
  // Buffer is available but the package targets a portable ES surface.
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // Bun and Node both expose `btoa` globally; the package's `engines`
  // pins them.
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------------------ */
/* Compare-URL builders                                                     */
/* ------------------------------------------------------------------------ */

interface PathAUrlInputs {
  pageUrl: string;
  fix_url?: string;
  fix_source?: string;
}

interface PathBUrlInputs {
  slug: string;
  // Layer 2/3 deep-link template — visitor pastes the artefact URL
  // into branch_url after the workflow run finishes.
  compareBaseUrl: string;
}

function pathACompareUrl(inputs: PathAUrlInputs): string {
  const u = new URL(inputs.pageUrl);
  if (inputs.fix_url) u.searchParams.set('fix_url', inputs.fix_url);
  else if (inputs.fix_source) u.searchParams.set('fix', base64UrlEncode(inputs.fix_source));
  return u.toString();
}

function pathBCompareUrl(inputs: PathBUrlInputs): string {
  const u = new URL(inputs.compareBaseUrl);
  u.searchParams.set('slug', inputs.slug);
  return u.toString();
}

function deriveCompareBaseFromPageUrl(pageUrl: string): string {
  // page_url is e.g. https://aletheia-works.github.io/vivarium/repro/<slug>/.
  // The compare page sits at /repro/compare under both /en and /ja chrome.
  // Default to no-locale (legacy /repro/compare) — R.3 mounts the same
  // component in both locales.
  try {
    const u = new URL(pageUrl);
    return `${u.origin}/vivarium/repro/compare`;
  } catch {
    return 'https://aletheia-works.github.io/vivarium/repro/compare';
  }
}

/* ------------------------------------------------------------------------ */
/* Instructions                                                             */
/* ------------------------------------------------------------------------ */

interface InstructionInputs {
  recipe: RecipeEntry;
  path: 'A' | 'B';
  compareUrl: string;
  ghCommand?: string;
  fixSupplied: boolean;
}

function buildInstructions(inputs: InstructionInputs): string {
  if (inputs.path === 'A') {
    const headline = inputs.fixSupplied
      ? `Open ${inputs.compareUrl} in a browser. The fix is pre-loaded — the page will run it through php-wasm/ruby.wasm/pyodide and capture a Contract v1 verdict.`
      : `Open ${inputs.compareUrl} in a browser, paste the candidate fix into the "Try a fix" panel, and click Run. The page will run it through the recipe's WASM runtime and capture a verdict.`;
    return [
      `**${inputs.recipe.title}** — Layer 1 (Path A: in-browser source substitution).`,
      '',
      headline,
      '',
      'After the run completes:',
      `1. Download \`branch-fix-verdict.json\` and \`original-verdict.json\` from the panel.`,
      `2. Drop both onto ${deriveCompareBaseFromPageUrl(inputs.recipe.page_url)} for side-by-side review.`,
      '',
      `**Verdict semantics.** \`reproduced\` = bug still triggers (fix is slop). \`unreproduced\` = bug avoided (fix steers around the broken code path). See [the walkthrough](${D5_DOC_URL_EN}) ([日本語版](${D5_DOC_URL_JA})) for the full loop.`,
    ].join('\n');
  }

  // Path B
  return [
    `**${inputs.recipe.title}** — Layer ${inputs.recipe.layer} (Path B: Docker image-based).`,
    '',
    `Build and push your branch-fix Docker image to a public registry the GitHub Actions runner can pull. Then run:`,
    '',
    '```bash',
    inputs.ghCommand ?? '(gh command unavailable)',
    '```',
    '',
    `Once the workflow finishes:`,
    `1. Download the \`branch-fix-verdict-${inputs.recipe.slug}-<run_id>\` artefact from the workflow run.`,
    `2. Drop the zip onto ${inputs.compareUrl} for side-by-side review (or pass \`?branch_url=\` with a publicly fetchable URL of the verdict JSON).`,
    '',
    `**Verdict semantics.** A working fix flips the verdict from \`reproduced\` to \`unreproduced\`. Pipeline spec: ${PIPELINE_DOC_URL}. Walkthrough: [English](${D5_DOC_URL_EN}) · [日本語](${D5_DOC_URL_JA}).`,
  ].join('\n');
}

/* ------------------------------------------------------------------------ */
/* Tool                                                                     */
/* ------------------------------------------------------------------------ */

export async function verifyBranchFix(
  args: VerifyBranchFixArgs,
): Promise<VerifyBranchFixResult> {
  const slug = args.slug?.trim();
  if (!slug) {
    return { ok: false, error: 'missing required argument: slug' };
  }

  if (args.fix_url && args.fix_source) {
    return {
      ok: false,
      error:
        'fix_url and fix_source are mutually exclusive — supply at most one',
    };
  }
  if (args.fix_source && args.fix_source.length > FIX_INLINE_LIMIT_BYTES) {
    return {
      ok: false,
      error: `fix_source exceeds the ${FIX_INLINE_LIMIT_BYTES}-byte inline limit; use fix_url with a publicly fetchable URL instead`,
    };
  }

  const { recipes } = await getCatalogue();
  const recipe = recipes.find((r) => r.slug === slug);
  if (!recipe) {
    return { ok: false, error: `recipe not found: ${slug}` };
  }

  const notes: string[] = [];

  if (recipe.layer === 1) {
    if (args.fix_url || args.fix_source) {
      // Path A inputs are valid; pre-load.
    } else {
      notes.push(
        'no fix_url or fix_source supplied — compare_url opens the recipe page; the user pastes manually into the "Try a fix" panel',
      );
    }
    const compareUrl = pathACompareUrl({
      pageUrl: recipe.page_url,
      fix_url: args.fix_url,
      fix_source: args.fix_source,
    });
    const instructions = buildInstructions({
      recipe,
      path: 'A',
      compareUrl,
      fixSupplied: Boolean(args.fix_url || args.fix_source),
    });
    return {
      ok: true,
      slug: recipe.slug,
      layer: recipe.layer,
      path: 'A',
      page_url: recipe.page_url,
      compare_url: compareUrl,
      instructions,
      notes,
    };
  }

  // Layer 2 / 3 → Path B.
  if (args.fix_url || args.fix_source) {
    notes.push(
      'fix_url and fix_source are ignored for Layer 2/3 recipes — the contributor builds and pushes a Docker image themselves; see ADR-0020 §1 for the image-as-input boundary',
    );
  }
  const compareBase = deriveCompareBaseFromPageUrl(recipe.page_url);
  const compareUrl = pathBCompareUrl({
    slug: recipe.slug,
    compareBaseUrl: compareBase,
  });
  const ghCommand = `gh workflow run branch-fix-verdict.yml --repo aletheia-works/vivarium -f slug=${recipe.slug} -f branch_image=<your-image-ref>`;
  const instructions = buildInstructions({
    recipe,
    path: 'B',
    compareUrl,
    ghCommand,
    fixSupplied: false,
  });
  return {
    ok: true,
    slug: recipe.slug,
    layer: recipe.layer,
    path: 'B',
    page_url: recipe.page_url,
    compare_url: compareUrl,
    gh_command: ghCommand,
    instructions,
    notes,
  };
}

export const VERIFY_BRANCH_FIX_TOOL = {
  name: 'verify_branch_fix',
  description:
    "Generate a deep-link URL and instructions for verifying a candidate branch-fix against a Vivarium recipe. SCAFFOLDING HELPER, not an execution engine — actual reproduction runs in the visitor's browser (Layer 1) or in GitHub Actions (Layer 2/3). Layer dispatch is automatic from the recipe's catalogue layer. Layer 1 returns Path A: a recipe-page URL with the fix pre-loaded via `?fix_url=` or `?fix=<base64url>`. Layer 2/3 returns Path B: a `/repro/compare` URL plus the `gh workflow run branch-fix-verdict.yml` command the contributor runs to capture a verdict against their pushed Docker image. Use after `match_error` or `list_recipes` has narrowed to a specific slug. Pair with the D-5 walkthrough page (https://aletheia-works.github.io/vivarium/guide/compare-branch-fix) for the full AI-slop verification loop.",
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
          "Public URL of the candidate fix source (raw.githubusercontent.com / gist.githubusercontent.com). Layer 1 only — embedded in the returned compare_url as `?fix_url=`. Mutually exclusive with fix_source.",
      },
      fix_source: {
        type: 'string' as const,
        maxLength: FIX_INLINE_LIMIT_BYTES,
        description:
          "Inline candidate fix source (max 4096 bytes). Layer 1 only — embedded in the returned compare_url as `?fix=<base64url>`. Mutually exclusive with fix_url. Long fixes should use fix_url instead.",
      },
    },
    required: ['slug'],
  },
} as const;
