---
name: round-trip
description: End-to-end Vivarium round-trip automation. Given an upstream GitHub issue URL, orchestrates the full loop — scaffold a reproduction recipe, capture the unfixed verdict, open the Vivarium-side PR, wait while the contributor forks + pushes a candidate fix branch, capture the fixed verdict against the fork, open the upstream draft PR. Each stage calls the appropriate MCP tool (`search_upstream_issues`, `prepare_new_recipe`, `verify_and_report_fix`, `create_fork_pr`) or `sl` / `gh` via Bash. On any stage failure the skill sets `roundtrip.json#/status` to `"blocked"`, appends the reason to `notes[]`, and hands back to the human — it never silently skips a step or proceeds past an unmet precondition. Use when the user pastes an upstream issue URL and asks to "do the round trip", "run /round-trip <url>", or equivalent in Japanese ("〜の round trip 回して"). Do NOT use for partial flows — for scaffold-only, use the `scaffold-recipe-from-issue` skill; for verdict-capture-only, call `verify_and_report_fix` directly.
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

Also fill in the facet overlay row in
`docs/site/_data/recipe-facets.json` (real values, not the
`TODO-fill-in` defaults from the scaffolder) and the projects row
in `docs/site/_data/projects.json` if the project is new. Then
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
last commit (`sl amend` after editing `roundtrip.json`) or commit a
follow-up — either is fine because the PR is still in early review.

**Do not wait for merge** to continue. The verified-unfixed PR can
stay in review while Stage 5-6 are in flight; the round-trip's
visibility is the point.

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

When the human confirms the branch is pushed and accessible at
`https://github.com/<your-user>/<upstream-repo>/blob/fix-issue-<n>/<path>`,
record `roundtrip.json#/fork = { owner, repo, branch }` and
continue.

### Stage 6: Capture fixed verdict

Call `verify_and_report_fix` again, this time with `fix_url` set to
the raw URL of the fix on the fork branch:

```jsonc
{
  "tool": "verify_and_report_fix",
  "args": {
    "slug": "<slug>",
    "fix_url": "https://raw.githubusercontent.com/<fork>/<branch>/<path>",
    "branch_image": "<ghcr-image-ref>",  // Layer 2/3 only
    "auto_execute": true,
    "current_state": <updated roundtrip.json>
  }
}
```

Expect `executed.ok === true` and `verdicts.fixed.verdict ===
"unreproduced"`. Merge `verdicts.fixed` into `roundtrip.json`, set
`status: "verified"`.

If the verdict is `reproduced` instead, the fix doesn't actually
fix the bug — stop, set `status: "blocked"`, and hand back to the
human to iterate on the fix.

### Stage 7: Update the Vivarium PR with the fixed verdict

The Vivarium PR from Stage 4 already exists. Push the updated
`roundtrip.json` (with `verdicts.fixed` now populated) to the same
PR:

```bash
sl addremove
sl commit -m "feat(layer<N>): <slug> — fixed verdict captured (<source>)"
sl pull
sl pr submit
```

This force-pushes the PR's branch to update its diff.

### Stage 8: Open the upstream draft PR

Call `create_fork_pr`:

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
- Run `gh pr create --repo <upstream> --head <fork>:<branch> --draft --title --body`. The body has an AI-authorship footer appended automatically (the `ai: generated` label is NOT applied — see Phase 4 review fixes; upstream usually doesn't carry that label or grant permission to create it).
- Return the PR URL.

Record `roundtrip.json#/upstream_pr` with the returned URL and set
`status: "upstream_open"`.

If the tool returns `ok: false`, surface the error: every
state-machine violation is named explicitly (e.g.
`"state machine expected next_action 'open_fork_pr' but
computeNextAction(current_state) returned 'open_vivarium_pr'"`), so
the user can fix the missing precondition.

### Stage 9: Final Vivarium-side commit

Push the final `roundtrip.json` (now with `upstream_pr` URL and
`status: "upstream_open"`) to the Vivarium PR:

```bash
sl addremove
sl commit -m "feat(layer<N>): <slug> — round-trip complete, upstream PR opened"
sl pull
sl pr submit
```

The round-trip is now visible from both sides:

- Vivarium PR shows the recipe + both verdicts + the upstream PR
  link.
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
   4 has already run; otherwise leave it as an uncommitted local
   change for the human to inspect.
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
