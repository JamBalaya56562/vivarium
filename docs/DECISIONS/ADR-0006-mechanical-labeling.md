# ADR-0006: Mechanical labeling only

## Status

Accepted

## Context

Labels on Issues and Pull Requests have multiple potential sources:

- Human judgement during triage
- AI inference from content
- Path-based automation (`actions/labeler`)
- Conventional-Commit prefix parsing
- CI-emitted events (success, failure, apply-failure, etc.)

Over a lifelong, AI-delegated project, inconsistent labeling becomes
a silent source of scope-boundary erosion. Labels applied by
judgement tend to drift over time: different humans label
differently, AI-inferred labels degrade as the taxonomy grows, and
downstream consumers (dashboards, routing, triage automation) cannot
trust the signal.

Mechanical sources produce deterministic, auditable labels that
stay trustworthy as the project scales.

## Decision

Labels on this project come **only** from mechanical sources:

- `scope: *` — from `.github/labeler.yml` path rules applied to
  changed files in a PR.
- `type: *` — from the Conventional-Commit prefix of the PR title or
  the associated commit message.
- `priority: *` — human-set. Explicit human judgement is an
  acceptable mechanical source when it is the sole source and is
  applied deliberately during triage.
- `status: *` — CI-emitted or human-set during triage. Agents may
  move `triage` ↔ `in-progress` ↔ `blocked` for Issues they are
  actively working.
- `ai: generated` — AI-authored PRs self-tag at creation time.
- `ai: verified` — a human applies this after reviewing the
  AI-authored change.

AI agents do **not** infer labels from content analysis. If a label
cannot be derived from one of the mechanical sources above, it
stays unset.

## Consequences

### Positive

- Labels remain trustworthy over time.
- Downstream automation (dashboards, routing, triage) can rely on
  label fidelity.
- Removes a common failure mode where AI applies plausible-but-wrong
  labels that pollute filters.

### Negative

- Some Issues sit with fewer labels than a quick human skim might
  apply.
- Mechanical rules — particularly `.github/labeler.yml` and the
  Conventional-Commit parser — must be kept in sync with the label
  taxonomy in `infra/github/labels.tf`.

## Alternatives considered

- **AI-inferred labels:** fast to bootstrap, degrades over time as
  the taxonomy grows and AI gets corrected inconsistently.
- **Manual-only labels:** does not scale with AI-agent Issue/PR
  volume; bottlenecks on the maintainer.

## References

- `.github/labeler.yml` — path-based rules.
- `infra/github/labels.tf` — label taxonomy.
- `AGENTS.md` § 4.6 — label conventions.
- `docs/AI_WORKFLOW.md` § 4 — label lifecycle.
