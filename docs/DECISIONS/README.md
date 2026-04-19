# Architecture Decision Records

This directory records significant decisions that shape Vivarium's
direction, so future contributors can see **why** the project looks the
way it does, not just **what** it looks like.

## When to write an ADR

Write an ADR when:

- The decision has meaningful alternatives that a reasonable person could
  prefer.
- The decision affects multiple areas of the project (architecture,
  infrastructure, workflow).
- The decision is hard to reverse — changing it later costs materially
  more than a normal refactor.
- The decision is load-bearing on other decisions.

Do **not** write an ADR for:

- Trivial style or convention choices — those belong in `AGENTS.md` or
  tooling configuration.
- Decisions that trivially derive from a principle already captured in a
  prior ADR.
- Day-to-day implementation choices.

## Numbering

ADRs are numbered `ADR-XXXX` starting at `0001`. Numbers are **never
reused**, even when an ADR is superseded.

## Status lifecycle

```
Proposed  →  Accepted  →  Superseded by ADR-NNNN
                     ↘  →  Deprecated (no replacement)
```

- **Proposed** — under discussion; not yet binding.
- **Accepted** — binding until superseded. Code or process changes that
  conflict with this ADR must either update the ADR or be rejected.
- **Superseded by ADR-NNNN** — the decision has been reversed or evolved
  by a later ADR. The original remains readable for historical context;
  it is **not** deleted.
- **Deprecated** — the decision no longer applies but has no direct
  replacement (e.g., the problem it solved no longer exists).

## Writing a new ADR

1. Copy [`_template.md`](_template.md) to
   `ADR-XXXX-short-title.md` with the next available number.
2. Fill in Context, Decision, Consequences.
3. Open a PR. Merge signals **Accepted** status unless the ADR is
   explicitly marked Proposed.

## Index

- [ADR-0001 — Adopt problem-centred framing](ADR-0001-problem-centred-framing.md)
- [ADR-0002 — Adopt three-layer architecture](ADR-0002-three-layer-architecture.md)
- [ADR-0003 — Use OpenTofu instead of Terraform](ADR-0003-opentofu-over-terraform.md)
- [ADR-0004 — Use Sapling as local SCM](ADR-0004-sapling-over-git.md)
- [ADR-0005 — Projects v2 is click-ops; Milestones and Labels are IaC](ADR-0005-projects-v2-click-ops.md)
- [ADR-0006 — Mechanical labeling only](ADR-0006-mechanical-labeling.md)
- [ADR-0007 — Squash into initial commit during bootstrap](ADR-0007-bootstrap-squash-policy.md)
