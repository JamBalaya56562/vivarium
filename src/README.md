# `src/` — Vivarium source tree

> Scaffolding only. Phase 0 has not committed to any specific implementation
> yet; this directory exists so layer boundaries are visible from day one.

---

## Why three layers?

Vivarium is **problem-centred, not technology-centred**. Different
reproduction problems have fundamentally different requirements:

| Problem shape                               | Needs                        | Layer |
|---------------------------------------------|------------------------------|-------|
| Pure algorithm, parser, data-processing bug | Instant startup, in-browser  | 1     |
| Whole-project bug with complex dependencies | Full OS fidelity, isolation  | 2     |
| Concurrency, memory, or non-deterministic   | Deterministic replay, snapshots | 3  |

Picking one layer as "the answer" would force square pegs into round
holes. The three-layer split exists so each problem class can be solved
on its own terms — see [`AGENTS.md § 5`](../AGENTS.md) and the eventual
[`docs/docs/ARCHITECTURE.md`](../docs/docs/) for the longer-form argument.

## Layout

```text
src/
├── layer1_wasm/      # browser-native, ms–s startup
├── layer2_docker/    # container-backed, s–min startup
└── layer3_thirdway/  # record-replay, microVM, deterministic
```

Each subdirectory has its own `README.md` describing the kinds of
problems routed to that layer. None contain production code yet —
bringing a layer online starts with a feature Issue, not with
speculative scaffolding.

## What does **not** live here

- **Infrastructure-as-Code** — lives in [`infra/`](../infra/).
- **Docs site** — lives in [`docs/`](../docs/) (markdown content under `docs/docs/`).
- **Tooling and build configuration** — project root.

## Current phase

Phase 0 (Bootstrap) will populate `layer1_wasm/` first, starting with a
hand-picked Pyodide + pandas reproduction PoC
([Issue #13](https://github.com/aletheia-works/vivarium/issues/13)).
Layers 2 and 3 are expected but unscheduled.
