# AI Workflow

> How the automated development cycle runs on `vivarium`.
> Audience: AI agents (for alignment), and humans (for oversight).
> Governing rules live in
> [AGENTS.md](https://github.com/aletheia-works/vivarium/blob/main/AGENTS.md);
> this document is the *process* layer on top of them.

---

## 1. The cycle, at a glance

```
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│  Human intent  │──▶│  Issue (GH)    │──▶│  Claude Code   │
│  (strategy)    │   │  structured    │   │  implements    │
└────────────────┘   └────────────────┘   └───────┬────────┘
                                                  │
                                                  ▼
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│  Human merge   │◀──│  Claude Code   │◀──│  PR (draft →   │
│  (decision)    │   │  reviews       │   │  ready)        │
└───────┬────────┘   └────────────────┘   └────────────────┘
        │
        ▼
┌────────────────┐
│  GitHub Actions│
│  CI / deploy   │
└────────────────┘
```

Every box is either a human decision (intent, merge), an AI contribution
(implement, review), or automation (CI, labels, release). The cycle is
*intentionally* non-autonomous at the merge point: human judgement closes
the loop.

All Issues and PRs land on the
[vivarium roadmap board](https://github.com/orgs/aletheia-works/projects/1)
automatically via the org-level Projects v2 **Auto-add to project**
workflow. The board — not this document — is the operational surface for
"what is in flight right now." This document only describes the shape of
the cycle.

The roadmap view is grouped by **milestone** (the Phase 0–5 swimlanes
defined in `infra/github/milestones.tf`) and uses two PR-level **Date**
fields as the timeline axis:

- **Started At** — set when the PR is opened.
- **Merged At** — set when the PR is closed *and* merged. Closed-without-
  merge PRs leave this empty.

Both fields are written by `.github/workflows/project-fields.yml`. The
default `GITHUB_TOKEN` cannot mutate org-scoped Projects v2, so the
workflow reads a **fine-grained PAT** from the `PROJECTS_TOKEN` repo
secret. To rotate or reissue:

1. Create a fine-grained PAT at
   <https://github.com/settings/personal-access-tokens/new> with
   *Resource owner* = `aletheia-works`, *Repository access* = `vivarium`
   only, and *Organization permissions → Projects: Read and write*.
2. Store it as the `PROJECTS_TOKEN` Actions secret on this repo.
3. Milestones stay under OpenTofu; the Project board itself remains
   click-ops until `terraform-provider-github` ships Projects v2
   resources (`infra/github/milestones.tf` for context).

## 2. Actors and responsibilities

### 2.1 Human

- Set strategy, scope, and phase ordering.
- File or approve Issues that define work.
- **Merge PRs.** Never delegated.
- Handle accounts, payments, and external-facing human dialogue.
- Rotate credentials and approve `tofu apply` against production state.

### 2.2 AI agents

| Agent         | Role                        | Installed? |
|---------------|-----------------------------|------------|
| Claude Code   | Primary implementer + reviewer | yes     |
| Dosu          | Issue triage & Q&A          | planned    |

- **Claude Code** plays two roles in this repo:
  1. **Implementer** — reads Issues, drafts PRs, opens follow-up Issues
     when it discovers out-of-scope work.
  2. **Reviewer** — on every non-draft PR, reads the diff against
     `AGENTS.md` / `CLAUDE.md` / the linked Issue and posts a single
     GitHub review (`COMMENT` or `REQUEST_CHANGES`, never `APPROVE`).
     Runs via `.github/workflows/claude-review.yml`.

  Both roles are constrained by
  [AGENTS.md § 2](https://github.com/aletheia-works/vivarium/blob/main/AGENTS.md)
  and
  [CLAUDE.md](https://github.com/aletheia-works/vivarium/blob/main/CLAUDE.md).
- **Dosu** (once enabled) answers repeat Issue questions and proposes
  initial triage labels, which a human confirms.

### 2.3 Automation

- **GitHub Actions** — CI, commitlint, labeler, release-notes, Terraform
  plan/apply, docs deploy. Thin callers into `aletheia-works/.github`
  reusables.
- **Dependabot** — dependency updates with `scope: *` labels applied
  automatically.
- **Labeler** (`.github/labeler.yml`) — path-based `scope: *` labels on
  PR open/synchronise.

## 3. Cycle stages

### 3.1 Issue creation

**Who**: human or Dosu (once enabled), never Claude Code unbidden except
as a *follow-up* Issue linked to an in-flight task.

**Structure**: every Issue includes

1. **Problem** — what observable behaviour is wrong or missing, stated in
   bug-reproduction terms when applicable.
2. **Desired outcome** — the post-condition that indicates "done."
3. **Scope boundary** — what this Issue is *not* trying to do.
4. **Hints** (optional) — file paths, prior art, related Issues.

**Labels** applied at creation:

- `type: *` — by the human or by the Conventional-Commit prefix chosen
  for the eventual PR.
- `status: triage` — default state until an agent picks it up.
- `priority: *` — set by the human.

### 3.2 Pick-up

Claude Code picks up an Issue when:

- The Issue is unambiguous enough that scope creep is unlikely, **and**
- The work is within the current phase (Phase 0 today), **and**
- The Issue does **not** carry `status: blocked` (see below), **and**
- No other agent is already assigned.

On pick-up the Issue moves to `status: in-progress`. If Claude discovers
the Issue is actually ambiguous or out of scope, it comments with the
blocker and returns the Issue to `status: triage` rather than guessing.

#### Respecting and applying `status: blocked`

`status: blocked` is a hard stop signal. An Issue carrying this label is
gated by something outside this repo — an upstream bug, an unshipped
library feature, a human-only step (account creation, secret rotation,
app install), or an unresolved dependency. Agents **must not** pick up a
blocked Issue, even if the title looks tractable; the block is real.

Conversely, when Claude Code picks up an Issue in good faith and hits a
blocker that cannot be resolved within scope, it must:

1. Apply the label:
   `gh issue edit <num> --repo aletheia-works/vivarium --add-label "status: blocked"`
2. Comment on the Issue summarising
   - what the blocker is (upstream bug link, missing resource, human
     action required),
   - what signal will unblock it (version release, human task done,
     dependency published),
   - and any workaround shipped in the meantime.
3. Move the Issue out of `status: in-progress` (remove the label) and
   stop work rather than ship a partial implementation.

The `status: *` family is the only status family agents may mutate, and
only within the `triage` ↔ `in-progress` ↔ `blocked` triangle — see § 4.

### 3.3 Implementation

- Work on a feature branch (`feat/<short-name>`, `fix/<short-name>`,
  etc.) unless the early-stage commit policy still applies (before the
  first PR has merged), in which case work is squashed into the initial
  commit and force-pushed to `main`.
- Commits follow Conventional Commits; the commitlint caller workflow
  will fail the check otherwise.
- `scope: *` labels attach automatically via path rules; do not hand-add
  them.
- **PR state mirrors implementation state.** Open the PR **ready for
  review** when the work meets the Issue's acceptance criteria and the
  implementer is confident there is nothing substantive left to change.
  Use **draft** mode only while implementation is still in progress or
  pending non-trivial rework (known failing tests, missing pieces,
  awaiting a human decision). If CodeRabbit or human review surfaces
  substantive rework, flip the PR back to draft until the rework is
  done, then flip it back to ready. Flipping between the two states is
  the implementer's signal of "not done" vs "please review" — AI
  implementers follow the same rule as humans; a draft is not a "polite"
  default.

### 3.4 Review

- **Claude Code** reviews automatically on PR open, ready-for-review, and
  every subsequent push. The `.github/workflows/claude-review.yml`
  workflow posts exactly one GitHub review per run — `COMMENT` or
  `REQUEST_CHANGES`, never `APPROVE`. The workflow runs unconditionally
  for PRs authored by the repository owner; other authors require the
  `ai: approved` label (added manually by the owner for trust).
- Review posture is substance-over-style: unverified claims, hallucinated
  APIs, security issues, state-safety issues, and scope-creep are in
  scope; indentation, line length, naming, and prose style are not —
  formatters, linters, and `tofu fmt` own those.
- Human may review at any point alongside Claude.
- If the review flags something the implementer disagrees with, the
  disagreement is surfaced to the human — *not* silently resolved by the
  AI.

### 3.5 Merge

- **Human-only.** The human merges once CI is green, the Claude review
  is satisfied, and the scope boundary from § 3.1 still holds.
- Squash-merge is the default so the PR-level Conventional-Commit prefix
  becomes the commit on `main`.

### 3.6 Post-merge

- Release-notes assembly is automated by `.github/workflows/release.yml`
  against `.github/release.yml` category rules.
- If `tofu apply` fails on `main`, a `status: apply-failure` Issue is
  auto-filed and auto-closed on recovery.
- Any TODOs or follow-ups Claude noticed during the work are filed as
  new Issues, not buried in the merged diff.

## 4. Label lifecycle

| Label family     | Applied by                        | Mutable by AI?         |
|------------------|-----------------------------------|------------------------|
| `type: *`        | Conventional-Commit parse         | no, mechanical only    |
| `scope: *`       | `.github/labeler.yml`             | no, mechanical only    |
| `priority: *`    | human                             | no                     |
| `status: *`      | CI or human; agents may move `triage` ↔ `in-progress` ↔ `blocked` | limited |
| `ai: approved`   | repository owner (manual trust check) | no                 |
| `ai: generated`  | attached to any PR Claude opens   | yes (self-tag)         |
| `ai: slop-risk`  | human / reviewer                  | no                     |
| `ai: verified`   | human after review                | no                     |

`ai: generated` exists as a *disclosure* mechanism — every AI-authored
change must wear it. The label definitions are in
[infra/github/labels.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/labels.tf).

## 5. Failure modes and escape hatches

- **AI slop risk.** If a PR feels like bulk without insight — generic
  tests, cosmetic refactors, unverified claims — the human applies
  `ai: slop-risk` and rejects. Do not try to hide AI-ness.
- **Scope creep.** If an Issue balloons mid-implementation, stop, close
  the current PR as draft, and file a new Issue for the overflow.
- **Stuck loop.** If Claude Code in `/loop` mode cannot make progress,
  it should end the loop with a short status message rather than pad
  with busywork.
- **Strategic drift.** If a proposed implementation contradicts the
  private project strategy, escalate to the human before writing code.

## 6. Out-of-scope for AI, always

Cross-referenced from
[AGENTS.md § 2](https://github.com/aletheia-works/vivarium/blob/main/AGENTS.md)
for convenience:

- Approving or merging PRs.
- Creating accounts or entering credentials.
- Financial transactions and external contracts.
- Production-destructive `tofu`/`gh`/`sl` commands.
- Rotating or exporting secrets.
- Human-facing community dialogue on behalf of the project.
- Root-level strategic pivots.

If the cycle above seems to demand one of these, the cycle is wrong —
stop and hand off.

## 7. Open follow-ups

Tracked elsewhere, not here:

- Install Dosu.
- Continue seeding the Phase 0 Issue backlog.

The `/claude`-triggered implementation workflow is in place at
[`.github/workflows/claude-implement.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/claude-implement.yml),
paired with the Claude-review workflow at
[`.github/workflows/claude-review.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/claude-review.yml).
An authorised commenter (write or admin permission) posting `/claude` on
a non-blocked Issue triggers Claude Code to open a PR against a fresh
branch; Claude then reviews the PR on every subsequent push. Guardrails
in `AGENTS.md` § 2 apply unchanged to both.
