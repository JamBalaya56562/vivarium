# ADR-0001: Adopt problem-centred framing

## Status

Accepted

## Context

Early strategy explorations anchored the project to specific
technologies: "a WASM service", "a Docker-based reproducer", "a
record-replay tool". Each framing drew natural scope boundaries from
the chosen technology rather than from the user's actual need.

The user's actual need is: *"can I reproduce this bug cheaply?"*

When the project is framed by a technology, the boundary becomes
"what can this technology reproduce?" — and anything outside falls
away as out-of-scope. When framed by the problem, the boundary
becomes "what do we need to add in order to reproduce this?" — and
unreachable categories become engineering gaps to close, not
exclusions.

## Decision

Vivarium is framed around the reproduction problem, not around any
specific technology. Technology choices are derived from the
reproduction scenarios we prioritise, in the order the roadmap
dictates.

This framing is load-bearing on every other ADR and on the
three-layer architecture (ADR-0002).

## Consequences

### Positive

- Strategic coherence when new technologies emerge (WASI Preview 3+,
  post-quantum runtimes, etc.): we ask whether they help reproduce
  bugs, not whether they fit our existing stack.
- Clear non-competition with tech-anchored players: we do not
  compete on "best WASM environment" — we compete on "best
  reproduction".
- Natural alignment with users, who think in bug-reproduction terms,
  not runtime terms.

### Negative

- Harder elevator pitch. "Reproduce any bug" is less immediately
  grippable than "run Python in the browser".
- Easy to drift into doing everything. Mitigated by `NON_GOALS.md`.

## Alternatives considered

- **Anchor to WASM.** Quick differentiation but caps the ceiling at
  what WASM can reach.
- **Anchor to Docker.** Fights directly with GitHub Codespaces,
  which is already the incumbent there.
- **Anchor to AI review.** Overcrowded market (CodeRabbit, Greptile,
  Qodo, Cursor BugBot, Sourcery, etc.).

## References

- `docs/VISION.md`
- `_context/ambitious_integrated_platform_strategy.md` (local-only
  source strategy)
