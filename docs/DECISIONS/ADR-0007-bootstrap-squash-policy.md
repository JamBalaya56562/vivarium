# ADR-0007: Squash into initial commit during bootstrap

## Status

Accepted — active until the first PR merges on a given repository.
After that transition, the policy is automatically retired and
normal per-commit granularity applies.

## Context

Before a repository has any merged Pull Requests, its history
consists of a single initial bootstrap commit (or a small pre-PR
series). During this phase, commit granularity offers no reviewer
benefit — there are no external reviewers yet — and a messy history
forces the first PR reviewer to read more than they need to.

Once PRs exist, commit granularity becomes load-bearing: diff
auditability, `git blame` / `sl blame`, bisect, and cherry-pick all
rely on meaningful boundaries. The bootstrap-era policy must end
the moment the repo has a real reviewer.

Sapling (ADR-0004) introduces an additional wrinkle: once a commit
is pushed, Sapling marks it public and blocks `amend` / `fold` /
`uncommit` / `debugstrip`. A **nuclear-reset** workaround is
required for continued folding during bootstrap.

## Decision

Until the first PR has merged on a given `aletheia-works`
repository:

- All follow-up changes to bootstrap content fold into the existing
  **initial commit** via `sl amend` or `sl fold`.
- If Sapling's public-commit lockout blocks `amend` / `fold`, the
  **nuclear-reset recipe** is accepted as a last resort:

  ```sh
  rm -rf .sl/
  sl init --git .
  sl config --local paths.default <remote-url>
  sl add .
  sl commit -m "<original initial message>"
  sl push --to main --force --non-forward-move
  ```

  Working-copy file contents are preserved because `.sl/` only
  holds Sapling state.

- Force-push to `main` is accepted during this phase because there
  are no collaborators to disrupt.
- The agent must state once per session that a history rewrite is
  occurring, so the user can veto.

**Transition signal:** the first merged PR on the repository.
After that point:

- Normal per-commit granularity applies.
- Force-push to `main` is forbidden.
- `infra/github/branch_protection.tf` should be updated to set
  `allows_force_pushes = false`.

## Consequences

### Positive

- Clean single-commit history at the moment external reviewers
  first look at the repo.
- No commitment to premature commit granularity during the
  messy-bootstrap phase.
- Bootstrap iteration friction stays low.

### Negative

- History rewriting is destructive; any local clone must re-sync
  after a nuclear reset.
- The nuclear-reset recipe is unusual and must be documented to
  avoid surprising future contributors.

## Alternatives considered

- **Per-commit granularity from the start:** noisy history before
  anyone reviews it; increased cognitive load on the first real
  reviewer.
- **Single commit, no rewrites:** forces all bootstrap changes into
  a single PR, which would be too large to review effectively.

## References

- ADR-0004 — Sapling as local SCM (source of the public-commit
  lockout constraint).
- `AGENTS.md` § 4.5 — early-stage commit policy.
- `docs/AI_WORKFLOW.md` § 3.3 — how this interacts with the PR
  cycle.
