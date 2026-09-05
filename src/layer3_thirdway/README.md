# Layer 3 — "Third way"

> Reproduction for bugs Layers 1 and 2 cannot reach on their own:
> heisenbugs, races, memory-ordering bugs, time-travel debugging.
>
> **This layer currently ships no recipes.** The catalogue is declared —
> `recipe.json`'s `layer` field, the manifest spec's `[layer3]` table and
> the gallery's layer facet all still accept it — but nothing is authored
> here yet. See [Why record-replay is not here](#why-record-replay-is-not-here).

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
| [Antithesis](https://antithesis.com)-style      | Deterministic distributed sim   |
| WASI Preview 3+ with snapshot hooks             | Replayable WASM executions      |
| CRIU                                            | Process snapshot & restore      |
| Firecracker snapshots                           | microVM-level time travel       |

Each is a candidate, not a commitment. A runtime earns a place here by
clearing the bar in the next section.

## Why record-replay is not here

Vivarium's first reproduction attempt at this layer was
[`rr`](https://rr-project.org). It was removed, and the reason generalises
into the admission criterion for anything that lands here next.

A Vivarium recipe has to be reproducible by whoever reads it. `rr` is not:

- **Linux/x86_64 only.** A contributor on Windows or macOS cannot verify
  the recipe at all.
- **Needs an exposed PMU and CPUID faulting.** Hyper-V, WSL2 and GitHub's
  hosted Ubuntu runners all fail those preconditions — confirmed by
  measurement, not by reading documentation.
- **Unverifiable in practice.** With so few environments able to run it,
  a reader has no cheap way to tell a genuine reproduction from a broken
  one. A verdict nobody can independently check is not evidence.

So the bar for a Layer 3 runtime is not "does it capture the bug" but
**"can a reader on an ordinary machine reproduce and check the result".**
CRIU and Firecracker snapshots inherit `rr`'s Linux-kernel dependency and
would have to clear the same bar; deterministic simulation and WASI
Preview 3+ are more promising precisely because they do not.

## Adding a first reproduction

There is no per-recipe convention yet — the previous one was shaped
around `rr` and went with it. Whoever authors the first recipe here
defines the shape, and should update this README and
[`.claude/rules/recipe-authoring.md`](../../.claude/rules/recipe-authoring.md)
in the same PR.

Start from the criterion above. If the runtime cannot be exercised on a
reviewer's own machine, it belongs in a discussion, not in this
directory.
