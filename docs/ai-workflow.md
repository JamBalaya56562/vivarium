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
│  Human merge   │◀──│  CodeRabbit    │◀──│  PR (draft →   │
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
| Claude Code   | Primary implementer         | yes        |
| CodeRabbit    | Automated PR review         | yes        |
| Dosu          | Issue triage & Q&A          | planned    |

- **Claude Code** reads Issues, drafts PRs, iterates on review feedback,
  and opens follow-up Issues when it discovers out-of-scope work.
  Constrained by
  [AGENTS.md § 2](https://github.com/aletheia-works/vivarium/blob/main/AGENTS.md)
  and
  [CLAUDE.md](https://github.com/aletheia-works/vivarium/blob/main/CLAUDE.md).
- **CodeRabbit** provides line-level review on every PR. Its comments
  are advisory — the human still merges.
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
- Draft PR opened early. Iterate in the draft; mark ready for review
  when the implementer considers the work complete.

### 3.4 Review

- **CodeRabbit** reviews automatically on PR open and on every push.
- Claude Code addresses CodeRabbit comments in follow-up commits. The
  `.github/workflows/claude-respond-to-coderabbit.yml` workflow automates
  this for PRs authored by the repository owner (or PRs carrying the
  `ai: approved` label added manually by the owner for trust).
- Human may also review at any point.
- If CodeRabbit and the implementer disagree on a judgement call, the
  disagreement is surfaced to the human — *not* silently resolved by the
  AI.

### 3.5 Merge

- **Human-only.** The human merges once CI is green, CodeRabbit is
  satisfied, and the scope boundary from § 3.1 still holds.
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
| `ai: escalated`  | the CodeRabbit-response workflow on cap trip | no           |

`ai: generated` exists as a *disclosure* mechanism — every AI-authored
change must wear it. The label definitions are in
[infra/github/labels.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/labels.tf).

## 5. Failure modes and escape hatches

- **AI slop risk.** If a PR feels like bulk without insight — generic
  tests, cosmetic refactors, unverified claims — the human applies
  `ai: slop-risk` and rejects. Do not try to hide AI-ness.
- **Scope creep.** If an Issue balloons mid-implementation, stop, close
  the current PR as draft, and file a new Issue for the overflow.
- **Iteration cap.** The CodeRabbit-response workflow caps at 5
  Claude-authored commits per PR. On cap trip, `ai: escalated` is
  applied and the work hands off to a human reviewer.
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

The `/claude`-triggered implementation workflow is now in place at
[`.github/workflows/claude-implement.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/claude-implement.yml),
complementing the CodeRabbit-response workflow already in production. An
authorised commenter (write or admin permission) posting `/claude` on a
non-blocked Issue triggers Claude Code to open a draft PR against a
fresh branch; guardrails in `AGENTS.md` § 2 apply unchanged.
