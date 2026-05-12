# `src/` — Vivarium source tree

> Reproduction recipes live here, grouped by the layer they exercise.

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
on its own terms — see [`AGENTS.md § 5`](../AGENTS.md) and
[`docs/docs/en/architecture.mdx`](../docs/docs/en/architecture.mdx) for the
longer-form argument.

## Layout

```text
src/
├── layer1_wasm/      # browser-native, ms–s startup
├── layer2_docker/    # container-backed, s–min startup
└── layer3_thirdway/  # record-replay, microVM, deterministic
```

Each subdirectory has its own `README.md` describing the kinds of
problems routed to that layer and the conventions for recipes in that
catalogue.

## What does **not** live here

- **Infrastructure-as-Code** — lives in [`infra/`](../infra/).
- **Docs site** — lives in [`docs/`](../docs/) (markdown content under `docs/docs/`).
- **Tooling and build configuration** — project root.
