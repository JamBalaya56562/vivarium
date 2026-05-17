// Scaffolding helper for registering a fix-candidate spec on an
// existing Layer 1 recipe — writes a `fix-candidate.json` next to
// the recipe, and the CI deploy-docs workflow turns the linked fix
// branch into a wheel built on the runner so the recipe page can run
// it side-by-side with the released build. Returns the spec content
// and the gh / git command bundle the agent should run; no git or
// network operations happen inside the MCP server.

import { getCatalogue } from '../catalogue.js';
import type { RecipeEntry } from '../types.js';

export interface PrepareFixCandidateArgs {
  slug?: string;
  fork_url?: string;
  branch?: string;
  upstream_pr?: string;
  package?: string;
  purpose?: string;
}

interface FixCandidateJson {
  schema_version: 1;
  package: string;
  purpose: string;
  source: { type: 'git'; url: string; ref: string };
  upstream_pr?: string;
}

interface PrepareFixCandidateOk {
  ok: true;
  slug: string;
  layer: 1;
  recipe_url: string;
  fix_candidate_path: string;
  fix_candidate_json: FixCandidateJson;
  branch_name: string;
  commit_subject: string;
  pr_title: string;
  pr_body: string;
  commands: string[];
  next_steps: string[];
  references: {
    rules: string;
    builder_script: string;
  };
}

interface PrepareFixCandidateError {
  ok: false;
  error: string;
}

export type PrepareFixCandidateResult =
  | PrepareFixCandidateOk
  | PrepareFixCandidateError;

// Bare GitHub repo URL — `https://github.com/<owner>/<repo>` with
// optional trailing slash. Tree / blob / pull URLs are rejected so the
// generated `fix-candidate.json` always carries the canonical clone
// URL.
const GITHUB_REPO_URL_REGEX = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i;

function recipePageUrl(entry: RecipeEntry): string {
  return entry.page_url;
}

function buildPrBody(args: {
  slug: string;
  recipeUrl: string;
  fixCandidatePath: string;
  forkUrl: string;
  branch: string;
  upstreamPr: string;
  pkg: string;
}): string {
  const lines: string[] = [];
  lines.push(
    `Register a fix-candidate spec for \`${args.slug}\` so the recipe page runs the fix branch's wheel side-by-side with the released build.`,
  );
  lines.push('');
  lines.push(`- Recipe: <${args.recipeUrl}>`);
  lines.push(`- Spec: \`${args.fixCandidatePath}\``);
  lines.push(`- Fork: \`${args.forkUrl}@${args.branch}\``);
  if (args.upstreamPr) lines.push(`- Upstream PR: <${args.upstreamPr}>`);
  lines.push('');
  lines.push(
    `After merge, CI builds the fix-candidate wheel from the fork branch on every deploy via \`scripts/build-layer1-wheels.sh\`. The recipe page then installs both \`${args.pkg}\` from PyPI and the fork-branch wheel into the same Pyodide tab and runs the same probe against each — the bug should reproduce under the baseline and not under the fix candidate.`,
  );
  lines.push('');
  lines.push('<details>');
  lines.push('<summary>How fix-candidate verification works</summary>');
  lines.push('');
  lines.push(
    "`fix-candidate.json` is a tracked one-screen JSON spec at the recipe root; it keeps wheel binaries out of the repo while still letting the recipe page run the fix branch live. On every push to `main`, the deploy-docs workflow:",
  );
  lines.push('');
  lines.push('1. Reads each `src/layer1_wasm/<slug>/fix-candidate.json`.');
  lines.push(
    '2. Builds a wheel from the spec\'s fork URL + branch via `pip wheel --no-deps "<pkg> @ git+<url>@<branch>"` in a `uv` ephemeral venv.',
  );
  lines.push(
    "3. Writes the wheel + a generated `manifest.json` into the recipe's `wheels/` sibling directory (gitignored).",
  );
  lines.push(
    '4. Bundles the recipe directory into the Pages artefact, so the wheel is served from the same origin as the page.',
  );
  lines.push('');
  lines.push(
    'On page load, `repro.ts` fetches `./wheels/manifest.json` and `micropip.install`s the wheel URL it resolves to. Refreshing the fix candidate is a one-line edit to this spec — no binary churn.',
  );
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('_Generated with [Claude Code](https://claude.com/claude-code)_');
  return lines.join('\n');
}

export async function prepareFixCandidate(
  args: PrepareFixCandidateArgs,
): Promise<PrepareFixCandidateResult> {
  const slug = (args.slug ?? '').trim();
  const forkUrl = (args.fork_url ?? '').trim().replace(/\/$/, '');
  const branch = (args.branch ?? '').trim();
  const upstreamPr = (args.upstream_pr ?? '').trim();
  const pkgOverride = (args.package ?? '').trim();
  const purposeOverride = (args.purpose ?? '').trim();

  if (!slug) return { ok: false, error: 'slug is required' };
  if (!forkUrl) return { ok: false, error: 'fork_url is required' };
  if (!branch) return { ok: false, error: 'branch is required' };

  if (!GITHUB_REPO_URL_REGEX.test(forkUrl)) {
    return {
      ok: false,
      error: `fork_url must be a bare GitHub repo URL like "https://github.com/<owner>/<repo>" (got "${forkUrl}"). Tree / blob / pull URLs are rejected; pass the canonical clone URL.`,
    };
  }

  const catalogue = await getCatalogue();
  const entry = catalogue.recipes.find((r) => r.slug === slug);
  if (!entry) {
    return {
      ok: false,
      error: `slug "${slug}" not found in the recipe catalogue. Use list_recipes to discover the slug.`,
    };
  }
  if (entry.layer !== 1) {
    return {
      ok: false,
      error: `fix-candidate verification is currently only wired up for Layer 1 recipes; "${slug}" is layer ${entry.layer}. Layers 2/3 use a different verification path — see verify_branch_fix.`,
    };
  }

  const pkg = pkgOverride || entry.project;
  const purpose =
    purposeOverride ||
    `fix-candidate verification for ${entry.project}/${entry.project}#${entry.issue}`;

  const fixCandidateJson: FixCandidateJson = {
    schema_version: 1,
    package: pkg,
    purpose,
    source: { type: 'git', url: forkUrl, ref: branch },
    ...(upstreamPr ? { upstream_pr: upstreamPr } : {}),
  };

  const fixCandidatePath = `src/layer1_wasm/${slug}/fix-candidate.json`;
  const branchName = `register-fix-candidate-${slug}`;
  const commitSubject = `feat(wasm): register fix-candidate for ${slug}`;
  const prTitle = commitSubject;
  const recipeUrl = recipePageUrl(entry);
  const fixCandidateJsonStr = JSON.stringify(fixCandidateJson, null, 2);

  const prBody = buildPrBody({
    slug,
    recipeUrl,
    fixCandidatePath,
    forkUrl,
    branch,
    upstreamPr,
    pkg,
  });

  // Heredoc inside the single-quoted strings below (`<<'EOF'`) keeps
  // the JSON literal byte-for-byte intact when the agent pastes the
  // command bundle into a shell.
  const commands = [
    '# 1. Make sure you have a clone of aletheia-works/vivarium (fork it first if you do not have write access).',
    'gh repo fork aletheia-works/vivarium --clone --remote=false',
    'cd vivarium',
    '',
    '# 2. Branch off main.',
    `git checkout -b ${branchName} main`,
    '',
    `# 3. Write ${fixCandidatePath} (the literal JSON from fix_candidate_json).`,
    `mkdir -p "$(dirname ${fixCandidatePath})"`,
    `cat > ${fixCandidatePath} <<'EOF'`,
    fixCandidateJsonStr,
    'EOF',
    '',
    '# 4. (Optional) Build the wheel locally to confirm the spec resolves.',
    'mise install && mise run repro:build:wheels',
    '',
    '# 5. Commit + push to your fork.',
    `git add ${fixCandidatePath}`,
    `git commit -m '${commitSubject}'`,
    `git push -u origin ${branchName}`,
    '',
    '# 6. Open the PR against aletheia-works/vivarium (paste pr_body into pr-body.md first).',
    `gh pr create --repo aletheia-works/vivarium --base main --title '${prTitle}' --body-file pr-body.md`,
    '',
    '# 7. Apply the AI authorship label (replace <pr-number> with the URL the previous step prints).',
    "# gh pr edit <pr-number> --repo aletheia-works/vivarium --add-label 'ai: generated'",
  ];

  const nextSteps = [
    `Confirm the fork branch builds a Pyodide-compatible wheel: \`pip wheel --no-deps "${pkg} @ git+${forkUrl}@${branch}"\` should produce a \`*-py3-none-any.whl\`. Native-extension packages need a different path (Layer 2).`,
    'Open the PR using the commands above; the Vivarium CI will build the wheel and deploy the updated page automatically once merged.',
    `After deploy, eyeball the recipe page at <${recipeUrl}> — the page now installs both the baseline and the fork-branch wheel and shows two output panels.`,
    `When the upstream PR merges and a fixed release lands on PyPI, open a follow-up PR to bump the canonical pin and remove ${fixCandidatePath} (the two-variant scaffolding becomes redundant).`,
  ];

  return {
    ok: true,
    slug,
    layer: 1,
    recipe_url: recipeUrl,
    fix_candidate_path: fixCandidatePath,
    fix_candidate_json: fixCandidateJson,
    branch_name: branchName,
    commit_subject: commitSubject,
    pr_title: prTitle,
    pr_body: prBody,
    commands,
    next_steps: nextSteps,
    references: {
      rules:
        'https://github.com/aletheia-works/vivarium/blob/main/.claude/rules/recipe-authoring.md',
      builder_script:
        'https://github.com/aletheia-works/vivarium/blob/main/scripts/build-layer1-wheels.sh',
    },
  };
}

export const PREPARE_FIX_CANDIDATE_TOOL = {
  name: 'prepare_fix_candidate',
  description:
    "Register a fix-candidate spec on an existing Layer 1 (WASM/Pyodide) Vivarium recipe so the recipe page runs the fix branch's wheel side-by-side with the released build. SCAFFOLDING HELPER, not an execution engine — same pattern as prepare_new_recipe and verify_branch_fix. Given a recipe slug + fork repo URL + branch name, returns: the `fix-candidate.json` content the agent should write, the recommended commit subject + PR title, a ready-to-paste PR body (with the AI-authorship and fix-candidate spec details tucked inside a `<details>` block), and the exact `gh` / `git` commands to fork-and-clone aletheia-works/vivarium, branch off main, drop the spec in, commit, push, and open the cross-repo PR. Use this immediately after opening an upstream fix branch (e.g. on a fork of mpmath/mpmath) when you want Vivarium to verify the fix live in-browser without waiting for upstream merge + a PyPI release. Validates the slug against the bundled catalogue and rejects non-Layer-1 recipes (Layers 2/3 use a different verification path — see verify_branch_fix).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      slug: {
        type: 'string' as const,
        description:
          "Existing Layer 1 recipe slug to register the fix candidate on (e.g. 'mpmath-983'). Must resolve to a Layer 1 entry in the bundled catalogue — call list_recipes if you need to discover it.",
      },
      fork_url: {
        type: 'string' as const,
        pattern: '^https?://github\\.com/[^/]+/[^/]+/?$',
        description:
          "Bare GitHub repo URL of the fork that hosts the fix branch (e.g. 'https://github.com/JamBalaya56562/mpmath'). Tree / blob / pull URLs are rejected; pass the canonical clone URL.",
      },
      branch: {
        type: 'string' as const,
        description:
          "Branch name on the fork that contains the fix (e.g. 'claude/fix-mpmath-983-aBcDe').",
      },
      upstream_pr: {
        type: 'string' as const,
        description:
          "Optional URL of the PR you opened from this fork branch (e.g. 'https://github.com/mpmath/mpmath/pull/<n>' or the fork-side draft PR URL while the upstream PR is still in progress). Embedded in the generated fix-candidate.json and surfaced in the page UI.",
      },
      package: {
        type: 'string' as const,
        description:
          "Optional pip distribution name override. Defaults to the recipe's project name (e.g. 'mpmath' for the mpmath-983 recipe). Override only when the project name and the pip distribution name diverge.",
      },
      purpose: {
        type: 'string' as const,
        description:
          "Optional purpose / one-liner. Defaults to 'fix-candidate verification for <project>/<project>#<issue>'.",
      },
    },
    required: ['slug', 'fork_url', 'branch'],
  },
} as const;
