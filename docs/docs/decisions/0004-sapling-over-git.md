# ADR-0004: Use Sapling as local SCM

## Status

Accepted

## Context

Git is the universal protocol for code collaboration, especially on
GitHub. Git's ergonomics, however, are hostile for the iterative
history-editing workflow common in early-stage bootstrap and in
AI-assisted development — rebase, amend, absorb, and stack
management each have sharp edges.

[Sapling](https://sapling-scm.com) (from Meta) provides a more
ergonomic command surface on top of the Git protocol: a cleaner
revset language, first-class stack management, and safer history
editing. It interoperates with Git remotes transparently via
`sl init --git`.

## Decision

The primary local SCM for this project is **Sapling (`sl`)**. GitHub
remains the remote, so standard Git tooling continues to work for
anyone who prefers it. When project documentation or tooling assumes
a command, it assumes `sl`; contributors using Git may translate.

## Consequences

### Positive

- Significantly better ergonomics for stack-based and amend-heavy
  workflows that the AI-delegation model produces naturally.
- Interoperates transparently with Git remotes — no GitHub-side
  migration needed.
- Better suited to AI-agent workflows that produce and revise
  changesets rapidly.

### Negative

- Smaller ecosystem. Fewer tutorials, fewer editor integrations,
  fewer CI recipes written against Sapling directly.
- Contributors who only know Git must learn Sapling commands or
  fall back to Git on their own machine.
- Some workflows — particularly rewriting already-pushed commits —
  hit Sapling's public-commit lockout and require documented
  workarounds (see [ADR-0007](./0007-bootstrap-squash-policy.md)).

## Alternatives considered

- **Git (stock):** baseline; rejected on ergonomics for the
  amend-heavy workflows we expect during bootstrap and AI iteration.
- **jj (Jujutsu):** similar ergonomic philosophy, but at the time of
  evaluation its Git-remote interop was less mature than Sapling's,
  and the ecosystem even smaller.

## References

- [Sapling](https://sapling-scm.com)
- [CLAUDE.md § 2 — Sapling-specific agent instructions](https://github.com/aletheia-works/vivarium/blob/main/CLAUDE.md)
- [ADR-0007 — Bootstrap squash policy](./0007-bootstrap-squash-policy.md) (references the public-commit lockout workaround)
