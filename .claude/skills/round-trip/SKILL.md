---
name: round-trip
description: End-to-end Vivarium round-trip automation. Given an upstream GitHub issue URL, orchestrates the full loop — scaffold a reproduction recipe, capture the unfixed verdict, open the Vivarium-side PR, wait while the contributor forks + pushes a candidate fix branch, capture the fixed verdict against the fork, open the upstream draft PR. The flow differs by layer — Layer 1 goes through the prepare_fix_candidate wheel pipeline (CI rebuild on Vivarium PR merge, then visual verdict confirmation on the live recipe page), while Layer 2/3 go through `mise run branch-fix:publish` + `branch-fix-verdict.yml`. On any stage failure the skill sets `roundtrip.json#/status` to `"blocked"`, appends the reason to `notes[]`, and hands back to the human. Use when the user pastes an upstream issue URL and asks to "do the round trip", "run /round-trip <url>", or equivalent in Japanese ("〜の round trip 回して"). Do NOT use for partial flows — for scaffold-only, use `scaffold-recipe-from-issue`; for verdict-capture-only, call `verify_and_report_fix` directly.
---

# round-trip

End-to-end Vivarium round-trip automation skill. Phase 5 of the
round-trip plan.

## When to invoke

The user provides an upstream GitHub issue URL and asks for the
**full loop** — scaffold + reproduce + verify + open both PRs.
Trigger phrases:

- "do the full round trip on <issue>"
- "run /round-trip <issue-url>"
- "reproduce, fix, and open the PR for <issue>"
- Japanese equivalents ("〜の round trip 回して", "再現から PR まで自動で")

Do NOT invoke for partial flows:

- Scaffold only → use `scaffold-recipe-from-issue`.
- Single-stage verdict capture → call `verify_and_report_fix`
  directly.
- Inspecting an existing round-trip → read `roundtrip.json` and call
  `verify_and_report_fix({ auto_execute: false })` for the
  state-machine summary.

## Inputs

Confirm these before starting; ask if missing:

1. **Upstream issue URL** — required, must be a GitHub issue URL.
2. **Target layer** — 1 (WASM), 2 (Docker), or 3 (record-replay).
   Default 2 unless the bug is clearly browser-runnable (Layer 1)
   or needs record-replay (Layer 3).
3. **One-line bug title** — used as the README H1.
4. **Layer 2 only — Docker base image** (e.g. `node:26-slim`).

## Layer flow at a glance

The fixed-verdict capture path differs by layer, so the skill
branches at Stage 6.

| Layer | Fixed-verdict path | Where the verdict comes from |
|---|---|---|
| 1 (WASM) | `prepare_fix_candidate` → `fix-candidate.json` → CI wheel build on Vivarium PR merge → recipe page renders baseline + fix-candidate side-by-side | The deployed page, confirmed visually by a human |
| 2 (Docker) | `mise run branch-fix:publish` → GHCR image → `verify_and_report_fix({ branch_image })` → `branch-fix-verdict.yml` workflow + artefact | The downloaded artefact's `branch-fix-verdict.json` |
| 3 (rr) | Not yet supported by `branch-fix-verdict.yml`; rejected upstream of this skill | — (skill bails to `manual_intervention`) |

Stages 0–5 are identical across layers; Stage 6 onwards branches.

## Stages

Each stage updates `roundtrip.json` and bails to `status: "blocked"`
on failure. The state machine in `verify_and_report_fix` /
`create_fork_pr` already short-circuits a blocked round-trip, so a
failed stage cannot accidentally restart.

### Stage 0: Pre-flight

Same as the `scaffold-recipe-from-issue` skill:

- Project activity check — caller-defined threshold, see
  [`.claude/rules/upstream-issue-selection.md`](../../rules/upstream-issue-selection.md).
- Exact issue inspection via:

  ```bash
  gh issue view <n> --repo <owner>/<repo> \
    --json state,title,body,labels,closedByPullRequestsReferences
  ```

  Confirm `state === OPEN`, body describes a reproducible bug, and
  `closedByPullRequestsReferences` is empty.

Stop if any check fails. Do NOT scaffold.

### Stage 1: Scaffold

Call the `prepare_new_recipe` MCP tool with the inputs above. It
returns `scaffold_command`, `roundtrip_init`, `roundtrip_path`, and
the facet / projects rows to add.

Run the scaffold (Layer 2):

```bash
mise run recipes:new -- <project> <issue> "<title>" --base <image>
```

For Layer 1 / 3, copy from an existing recipe in the same layer.

Write the returned `roundtrip_init` payload to `roundtrip_path` so
the recipe directory now has a `roundtrip.json` with `status: draft`
and `upstream_issue` set.

### Stage 2: Implement the reproduction (human + AI)

This stage is interactive — the skill prompts the user to fill in
the recipe files:

- **Layer 1**: `repro.ts`, `repro.<lang>`, `index.html`, `README.md`.
  Then `mise run repro:test` (or `mise run ci:repro`) to confirm.
- **Layer 2**: `Dockerfile`, `repro.sh`, `README.md`, `index.html`.
  Then `mise run recipes:verify <slug>` to confirm.
- **Layer 3**: per
  [`.claude/rules/recipe-authoring.md`](../../rules/recipe-authoring.md)
  Layer 3 specifics — needs a maintainer host with the rr
  preconditions.

Also write the per-recipe metadata file
`src/layer{1,2,3}_*/<slug>/recipe.json` (the `recipe_json.contents`
returned by `prepare_new_recipe`, with the `TODO-fill-in` fields
replaced by real values), and add the projects row in
`docs/site/_data/projects.json` if the project is new. Then
`mise run recipes:index` to regenerate derived artefacts.

When the user confirms the reproduction passes local verification,
continue to Stage 3.

### Stage 3: Capture unfixed verdict

Call `verify_and_report_fix`:

```jsonc
{
  "tool": "verify_and_report_fix",
  "args": {
    "slug": "<slug>",
    "auto_execute": true,
    "current_state": <contents of roundtrip.json>
  }
}
```

Expect:

- `executed.action === "verify_unfixed"` and `executed.ok === true`.
- `verdicts.unfixed.verdict === "reproduced"`.
- `next_action === "verify_fixed"`.

Merge the captured `verdicts.unfixed` into `roundtrip.json`, set
`status: "verifying"`, bump `updated_at`. If the verdict is
`unreproduced` instead, stop — the bug does not reproduce on the
runtime's current state, which contradicts the round-trip premise
(see `upstream-issue-selection.md §1`); set `status: "blocked"`
with a note explaining.

### Stage 4: Open the Vivarium-side PR (unfixed only)

The recipe + roundtrip.json need to land on `main` so contributors
on other machines can see the verified-unfixed state. Use Sapling
(this repo's SCM):

```bash
sl addremove
sl commit -m "feat(layer<N>): <slug> reproduction (unfixed verdict captured)"
sl pull
sl pr submit
```

After `sl pr submit` returns the PR URL, apply the `ai: generated`
label (AGENTS.md §4.6 — Vivarium-internal contract, the label and
permission both exist here):

```bash
gh pr edit <num> --repo aletheia-works/vivarium --add-label "ai: generated"
```

Record the PR URL as `roundtrip.json#/vivarium_pr` and amend the
last commit (`sl amend` after editing `roundtrip.json`) so the
recorded URL is visible in the same commit.

This is the commit that subsequent stages will keep updating via
`sl amend` (NOT new commits on top) so the PR branch stays a
single commit. Sapling's `sl pr submit` on a fresh commit creates
a *new* PR; `sl amend` rewrites the existing one in place and
`sl pr submit` then force-pushes the same branch. This matches
the project convention (see `.claude/CLAUDE.local.md` /
feedback_sl_pr_clean_stack).

**Do not wait for merge** to continue from this stage on Layer 2/3.
Layer 1 *does* need the merge (Stage 6 below) so the CI wheel
build can run; for Layer 1 the skill will stop and resume after
the human confirms the merge + deploy.

### Stage 5: Fork + push fix branch (human)

Driven by the human, with the skill prompting the steps:

```bash
# One-time fork creation (if not already done).
gh repo fork <upstream-owner>/<upstream-repo>

# Local clone, branch, fix.
git clone https://github.com/<your-user>/<upstream-repo>.git
cd <upstream-repo>
git checkout -b fix-issue-<n>
# ... apply the candidate fix ...
git commit -am "fix: <one-line summary>"
git push origin fix-issue-<n>
```

When the human confirms the branch is pushed, record
`roundtrip.json#/fork = { owner, repo, branch }` (amend the Stage-4
commit with `sl amend`, then `sl pr submit`).

### Stage 5.5: Build and push branch-fix Docker image (Layer 2 only)

**Layer 1 and Layer 3 skip this stage**:

- Layer 1 captures the fixed verdict via the `prepare_fix_candidate`
  wheel pipeline (Stage 6 below). No Docker image needed.
- Layer 3's `verify_fixed` is not yet supported by
  `branch-fix-verdict.yml`; the skill will bail with `status:
  "blocked"` at Stage 6 if the layer is 3.

For Layer 2, build a branch-fix Docker image whose base
incorporates the fork's fix branch, then push to GHCR. The
existing `branch-fix:publish` mise task wraps the docker build +
GHCR push with PAT-based auth that does not touch the `gh` CLI's
token:

```bash
mise run branch-fix:publish -- <slug> <tag> <branch-fix-dockerfile> <build-context>
# Output (printed last by the task): the GHCR image ref, e.g.
# ghcr.io/<your-user>/vivarium-<slug>-fix:<tag>
```

`<tag>` is conventionally the fork's fix commit SHA. The
`<branch-fix-dockerfile>` is a Dockerfile that bakes the fork's
fix branch into the recipe image (typically a small variant of the
upstream recipe's `Dockerfile`). The image ref printed by the task
is what Stage 6 passes as `branch_image` to
`verify_and_report_fix`.

Note: this stage requires a write:packages-scoped classic PAT
configured per the
[`branch-fix:publish`](https://github.com/aletheia-works/vivarium/blob/main/mise.toml)
task's one-time setup. The skill does NOT create that PAT for
the user.

### Stage 6: Capture fixed verdict

**Layer 1 (WASM) — via `prepare_fix_candidate` wheel pipeline:**

Layer 1's fixed-verdict path does NOT go through
`verify_and_report_fix({ fix_url })`. The Path A `?fix_url=`
substitutes the recipe's *reproduction* source, not the upstream
package itself — pointing it at a raw fix on the fork would run
the fix file as the reproduction and could return
`unreproduced` without actually exercising the upstream change.

Instead, register the fork as a fix-candidate via
`prepare_fix_candidate`. The CI deploy pipeline picks the
fix-candidate up on Vivarium PR merge, builds a wheel from the
fork branch, and the recipe page renders the baseline verdict +
the fix-candidate verdict side-by-side.

```jsonc
{
  "tool": "prepare_fix_candidate",
  "args": {
    "slug": "<slug>",
    "fork_url": "https://github.com/<fork-owner>/<upstream-repo>",
    "branch": "<fork-branch>"
  }
}
```

Write the returned `fix_candidate_json` content to
`src/layer1_wasm/<slug>/fix-candidate.json`. Amend the Stage-4
Vivarium commit (`sl addremove && sl amend && sl pr submit`) so
the same PR now also carries the fix-candidate registration.

**Layer 1 stops here for now.** The skill hands back to the
human. The remaining flow:

1. Human merges the Vivarium PR. `deploy-docs.yml` rebuilds the
   site and `scripts/build-layer1-wheels.sh` builds a wheel from
   the fork branch.
2. Human opens the live recipe page in a browser; the page
   renders the baseline verdict + the fix-candidate verdict.
3. Human visually confirms `verdicts.fixed.verdict ===
   "unreproduced"` and either re-invokes the skill (which will
   pick up at Stage 8 — open the upstream PR using the commands
   `prepare_fix_candidate` already returned) or runs those
   commands themselves.

For Layer 1, Stage 7 (Vivarium PR update with the fixed verdict)
is rolled into this stage's amend; there is no separate "update
PR with fixed verdict" step.

**Layer 2 (Docker) — via `branch-fix-verdict.yml` + artefact:**

Call `verify_and_report_fix` with the `branch_image` produced in
Stage 5.5:

```jsonc
{
  "tool": "verify_and_report_fix",
  "args": {
    "slug": "<slug>",
    "branch_image": "ghcr.io/<your-user>/vivarium-<slug>-fix:<tag>",
    "auto_execute": true,
    "current_state": <updated roundtrip.json>
  }
}
```

Expect `executed.action === "verify_fixed"` and
`verdicts.fixed.verdict === "unreproduced"`. Merge into
`roundtrip.json`, set `status: "verified"`. The tool internally
dispatches `branch-fix-verdict.yml`, polls until completion,
downloads the verdict artefact.

**Layer 3 (record-replay):** the tool currently rejects Layer 3
`verify_fixed` (Phase 3 review fix). Stop with `status:
"blocked"` and a note explaining workflow extension is needed.

### Stage 7: Update the Vivarium PR with the fixed verdict (Layer 2/3 only)

**Layer 1 already did this in Stage 6's amend — skip.**

For Layer 2 / 3:

```bash
# `roundtrip.json` is already edited locally with verdicts.fixed.
sl addremove        # rare; in case the verdict capture created files
sl amend            # rewrites the Stage-4 commit in place
sl pr submit        # force-pushes the same PR branch
```

`sl amend` (instead of a new `sl commit`) is load-bearing here.
Stacking new commits on top would cause `sl pr submit` to create
a *new* PR rather than updating the existing one — see the
project's `feedback_sl_pr_clean_stack` convention.

### Stage 8: Open the upstream draft PR

**Layer 1:** `prepare_fix_candidate` already returned the upstream
PR open commands in its `commands[]` field at Stage 6. The human
runs those after merging the Vivarium PR (so the fix-candidate is
live on the recipe page they reference from the upstream PR body).
The skill does NOT call `create_fork_pr` for Layer 1 — the
`prepare_fix_candidate` path is the established Layer 1 flow and
the upstream PR body it generates already cross-references the
recipe page.

**Layer 2 / 3:** Call `create_fork_pr`:

```jsonc
{
  "tool": "create_fork_pr",
  "args": {
    "slug": "<slug>",
    "current_state": <roundtrip.json with vivarium_pr + fork + verdicts>,
    "pr_title": "<conventional commit-ish title>",
    "pr_body": "<summary paragraph + link to the Vivarium round-trip PR + reproduction steps>",
    "dry_run": false
  }
}
```

The tool will:

- Verify `computeNextAction(current_state) === "open_fork_pr"` (the
  state machine integrity check — `status` not blocked / merged,
  no existing `upstream_pr`, verdicts verified, `vivarium_pr` set).
- Run `gh auth status` to ensure write scope is available.
- Verify the fork exists and the branch is pushed.
- Run `gh pr create --repo <upstream> --head <fork>:<branch> --draft --title --body`. The body has an AI-authorship footer appended automatically (the `ai: generated` label is NOT applied — upstream usually doesn't carry that label or grant permission to create it).
- Return the PR URL.

Record `roundtrip.json#/upstream_pr` with the returned URL and set
`status: "upstream_open"`.

If the tool returns `ok: false`, surface the error: every
state-machine violation is named explicitly (e.g.
`"state machine expected next_action 'open_fork_pr' but
computeNextAction(current_state) returned 'open_vivarium_pr'"`), so
the user can fix the missing precondition.

### Stage 9: Final Vivarium-side commit (Layer 2/3 only)

**Layer 1 ends after Stage 8** — the upstream PR's body already
points back at the live recipe page, and the Vivarium PR's
commits already include the fix-candidate registration. The human
can later update the Vivarium PR with the upstream PR URL via a
manual `sl amend`, but it's not load-bearing for the round-trip
loop.

For Layer 2 / 3:

```bash
# `roundtrip.json` is already edited locally with upstream_pr URL
# and status: "upstream_open".
sl addremove
sl amend -m "feat(layer<N>): <slug> round-trip complete (upstream PR opened)"
sl pr submit
```

`sl amend -m` updates both the commit content and message in
place; `sl pr submit` force-pushes the same PR branch.

The round-trip is now visible from both sides:

- Vivarium PR shows the recipe + both verdicts + the upstream PR
  link (Layer 2/3) or the fix-candidate registration (Layer 1).
- Upstream draft PR has the fix + body footer pointing back to
  Vivarium.

Hand back to the human. The upstream PR's merge (i.e. the human
flipping it from draft → ready and getting it merged upstream) is
out of scope; that update flows back into `roundtrip.json#/status =
"merged"` only after the human confirms it.

## Failure handling

At any stage, on failure:

1. Set `roundtrip.json#/status = "blocked"`.
2. Append the failure reason and the stage number to
   `roundtrip.json#/notes[]`.
3. Bump `roundtrip.json#/updated_at`.
4. Commit the updated `roundtrip.json` to the Vivarium PR if Stage
   4 has already run (`sl amend` + `sl pr submit`); otherwise
   leave it as an uncommitted local change for the human to
   inspect.
5. Stop. Do NOT auto-retry.

A subsequent `/round-trip` invocation on the same slug will detect
`status: "blocked"` via `computeNextAction` and refuse to resume
until the human clears the status. This is intentional.

## Guardrails (recap)

All of these are enforced by the underlying MCP tools — the skill
just sequences them:

- `verify_and_report_fix` short-circuits to `manual_intervention`
  when `status: "blocked"`; refuses to advance from a `merged` or
  `upstream_open` state.
- `verify_and_report_fix` rejects Layer 3 `verify_fixed` (Phase 3
  review fix — workflow extension needed).
- `create_fork_pr` defaults to `dry_run: true`; the skill flips it
  to `false` only at Stage 8, after every other precondition is
  satisfied.
- The upstream PR is always opened with `--draft`; merging out of
  draft stays a human action.
- AI authorship disclosure: body footer on the upstream PR (Phase
  4), `ai: generated` label on the Vivarium PR (AGENTS.md §4.6).
- The contributor's fork is created manually via `gh repo fork`;
  the skill never forks on the user's behalf.

## References

- [`upstream-issue-selection.md`](../../rules/upstream-issue-selection.md)
  — operating policy for picking which upstream issues to
  reproduce (used by Stage 0).
- [`recipe-authoring.md`](../../rules/recipe-authoring.md) — per-
  layer operational checklist (used by Stage 2).
- [`roundtrip.schema.json`](../../../docs/site/public/spec/roundtrip.schema.json)
  — canonical shape of the `roundtrip.json` this skill maintains.
- Phase 1 PR: [#250](https://github.com/aletheia-works/vivarium/pull/250).
- Phase 2 PR: [#252](https://github.com/aletheia-works/vivarium/pull/252).
- Phase 3 PR: [#254](https://github.com/aletheia-works/vivarium/pull/254).
- Phase 4 PR: [#256](https://github.com/aletheia-works/vivarium/pull/256).
