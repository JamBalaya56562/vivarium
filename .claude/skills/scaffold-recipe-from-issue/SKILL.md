---
name: scaffold-recipe-from-issue
description: Scaffold a new Vivarium reproduction recipe from an upstream GitHub issue URL (or owner/repo + issue number). Use when the user provides an upstream issue and asks to "reproduce it in Vivarium", "make a Layer N recipe for", "scaffold a recipe for", or similar phrasing. The skill runs the project activity check, calls the search_upstream_issues MCP tool to confirm the issue passes the strict selection policy (no related PR, repo not in repro-bot exclusion list), calls prepare_new_recipe to get the slug and scaffold commands, runs `mise run recipes:new` for Layer 2 (or guides copy-from-existing for Layer 1/3), and writes the initial roundtrip.json (status=draft) per the round-trip schema. Does NOT implement the reproduction itself — that is the user's next step. Read-only against the upstream issue; never auto-commits.
---

# scaffold-recipe-from-issue

Scaffold a new Vivarium reproduction recipe end-to-end from an upstream
GitHub issue. Phase 2 of the round-trip automation: input side.

## When to invoke

The user provides an upstream issue (URL, or `<owner>/<repo>` + issue
number) and asks to:

- "make a Layer N recipe for <issue>"
- "reproduce <upstream issue URL> in Vivarium"
- "scaffold a recipe for <project>#<issue>"
- equivalents in Japanese ("〜の再現レシピを作って" etc.)

Do NOT invoke for issues filed against the Vivarium repository itself —
those are tracked separately and do not need round-trip scaffolding.

## Inputs needed

Confirm these are known before starting; ask if missing:

1. **Upstream issue identifier** — URL like
   `https://github.com/nodejs/node/issues/63041`, or `<owner>/<repo>` +
   issue number.
2. **Target layer** — 1 (WASM in-browser), 2 (Docker), or 3 (record-
   replay). Default 2 unless the bug is clearly browser-runnable
   (Layer 1) or replay-required (Layer 3).
3. **One-line bug title** — used as the README H1 and the scaffold
   command argument.
4. **Layer 2 only — Docker base image** — e.g. `node:26-slim`.

## Steps

### 0. Pre-flight: project activity filter

Per `_context/strategy/issue_selection_policy.md §6`, confirm the
upstream project has ≥ 5 human-authored PR merges in the last 90 days
BEFORE doing any other work. The check is project-scope (one query per
project), not issue-scope, so it is the cheapest filter to run first.

```bash
gh pr list --repo <owner>/<repo> \
  --state merged \
  --search "merged:>=$(date -d '90 days ago' +%Y-%m-%d)" \
  --json number,author \
  --limit 50 \
  | jq '[.[] | select(.author.is_bot == false)] | length'
```

- Result ≥ 5 → continue.
- Result < 5, or only bot authors → STOP. Tell the user the project
  fails the activity filter and does not pass the selection policy; do
  not scaffold.
- Maintainer announcement of "unmaintained" / "looking for new
  maintainer" in README, pinned issue, or discussion → STOP regardless
  of count.

The activity-filter result is cacheable for 30 days per project (memo
locally if it helps).

### 1. Verify the specific issue passes strict selection

Call the `search_upstream_issues` MCP tool with a narrowing query:

```jsonc
// MCP tool call
{
  "tool": "search_upstream_issues",
  "args": {
    "repo": "<owner>/<repo>",
    "query": "in:title <keyword from title>",
    "selection_policy": "strict",
    "limit": 50
  }
}
```

If the user's target issue number is NOT in the returned `matches`,
the issue is either:

- linked to an existing PR (strict policy filters via `-linked:pr`) →
  selection_policy.md §2 says skip;
- in a repro-bot repo (e.g. `oven-sh/bun`) → §4 says skip.

In both cases STOP and explain why; do not scaffold.

### 2. Prepare scaffolding artefacts

Call the `prepare_new_recipe` MCP tool:

```jsonc
{
  "tool": "prepare_new_recipe",
  "args": {
    "project": "<project>",      // e.g. "node"
    "issue":   <issue_number>,   // e.g. 63041
    "title":   "<one-line title>",
    "layer":   1 | 2 | 3,
    "base_image": "<docker image, layer 2 only>"
  }
}
```

The tool returns:

- `slug` — `<project>-<issue>` (validated against the slug regex).
- `scaffold_command` — for Layer 2, the exact `mise run recipes:new`
  invocation to run. For Layer 1/3, a comment directing copy-from-
  existing.
- `verify_command` — the recipe verifier (Layer 2 only today).
- `recipe_facets_row` — append (after filling in real values) to
  `docs/site/_data/recipe-facets.json`.
- `projects_row` — append to `docs/site/_data/projects.json` ONLY if
  this is the project's first recipe.
- `roundtrip_init` — the JSON payload to write to `roundtrip_path`.
- `roundtrip_path` — the canonical relative path for the new
  roundtrip.json.
- `next_steps` — sequenced checklist for the user.

### 3. Run the scaffold command

**Layer 2:**

```bash
# Use the exact scaffold_command from prepare_new_recipe.
mise run recipes:new -- <project> <issue> "<title>" --base <image>
```

**Layer 1 / Layer 3:** copy from an existing recipe in the same layer
(e.g. `src/layer1_wasm/pandas-56679/` for a Pyodide recipe). The
scaffold command from `prepare_new_recipe` is a comment for these
layers — there is no scaffolder yet.

### 4. Write the initial roundtrip.json

Write the file at `roundtrip_path` (returned by `prepare_new_recipe`)
with the `roundtrip_init` payload. The payload validates against
`docs/site/public/spec/roundtrip.schema.json` (schema_version 1) and
starts in `status: draft`.

Sapling tracks the file automatically once `sl addremove` runs at PR
time.

### 5. Report next steps to the user

Hand the user the `next_steps` array from `prepare_new_recipe`. The
skill ENDS here. The actual reproduction implementation, verdict
capture, and PR opening are subsequent steps the user (or the
`/round-trip` skill, when Phase 5 lands) drives.

## Guardrails

- **Step 0 is non-skippable.** Running the scaffold on a dormant
  project produces a recipe whose upstream PR will never get merged,
  burning effort for nothing.
- **Read-only against the upstream issue.** Do not add comments, set
  labels, close, or otherwise modify the upstream issue. `gh issue
  view` for reading is fine; `gh issue comment` is not.
- **No auto-commit.** The recipe directory contains TODO stubs from
  the scaffolder; the user fills them in. Committing scaffold output
  as-is is a defect.
- **No PR opening.** Phase 4 handles fork PR creation; Phase 2 stops
  at "recipe directory + roundtrip.json on disk".
- **Layer 2 build weight.** If the upstream project's full build is
  too heavy for free-tier CI (selection_policy.md §5), explicitly
  flag the PAT-push branch-fix path to the user before they invest in
  the recipe. Heavy examples: Node.js (V8 build), Chromium, LLVM.

## References

- `_context/strategy/issue_selection_policy.md` — full selection
  policy.
- `.claude/rules/recipe-authoring.md` — operational checklist for
  recipe authoring (slug rules, data files, layer specifics).
- `docs/site/public/spec/roundtrip.schema.json` — canonical shape of
  the roundtrip.json this skill writes.
