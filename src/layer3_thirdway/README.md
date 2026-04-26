# Layer 3 — "Third way" (record-replay, microVM, deterministic)

> Reproduction for bugs Layers 1 and 2 cannot reach on their own:
> concurrency, non-determinism, heisenbugs, time-travel debugging.

---

## What routes here

- **Heisenbugs** — race conditions, memory-ordering bugs, use-after-free
  where a naive rerun will not reproduce the failure.
- **Long-replay scenarios** — an hour of production load condensed into
  a replayable trace.
- **Deterministic-simulation bugs** — distributed-system bugs where the
  failure depends on a specific message interleaving across nodes
  (Antithesis-style).
- **Post-mortem forensic replay** — stepping backwards through a
  captured execution, not forwards from a fresh run.

## What does **not** route here

- A bug you can reliably reproduce by running the program once → Layer 1
  or Layer 2.
- A bug whose fix is obvious from a single stack trace — Layer 3's cost
  (capture-time overhead, storage, tooling) is only justified when
  cheaper layers cannot observe the failure at all.

## Candidate runtimes

| Runtime / approach                              | Target                         |
|-------------------------------------------------|--------------------------------|
| [rr](https://rr-project.org)                    | Single-process record-replay    |
| [Pernosco](https://pernos.co)-style analysis    | Hosted backward-step debugging  |
| [Antithesis](https://antithesis.com)-style      | Deterministic distributed sim   |
| WASI Preview 3+ with snapshot hooks             | Replayable WASM executions      |
| CRIU                                            | Process snapshot & restore      |
| Firecracker snapshots                           | microVM-level time travel       |

Concrete choices land as ADRs in [`docs/docs/`](../../docs/docs/), not here.

## Phase 0 scope

**Not in Phase 0.** Layer 3 is the most speculative tier — it exists in
the architecture so that when a bug appears that *only* Layer 3 can
reach, we already have a place to put the work instead of inventing a
fourth category. This directory stays empty until a concrete Issue
proposes a Layer 3 vertical.
