# Vivarium specification

The Vivarium reproduction-verdict contract is a small, stable surface
that describes — for each reproduction page in the gallery — whether
the upstream bug reproduces against today's runtime, how to read the
verdict, and how to bundle a recorded snapshot for layers that
cannot run live in-page.

## Versions

- [Contract v1](./contract-v1.md) — current; stable since Phase 1.
- [`verdict.schema.json`](https://aletheia-works.github.io/vivarium/spec/verdict.schema.json) — JSON Schema
  (draft 2020-12) for the Layer 2 / Layer 3 verdict snapshot file
  defined by Contract v1.

There is no v2 today. Future bumps will land as siblings on this
page; v1 will remain readable for backward-compatible consumers.

## What this spec is for

- Reproduction pages (Layer 1, Layer 2, Layer 3) under
  [`aletheia-works/vivarium`](https://github.com/aletheia-works/vivarium)
  declare conformance via the `<meta name="vivarium-contract">` tag
  and the `"contract": "v1"` JSON field.
- External tools (CI, IDE plugins, AI reviewers, third-party
  reproduction definitions) read the same surface to know whether a
  page reproduces today.
- Future Vivarium-compatible reproductions hosted *outside* this
  repo can declare conformance the same way.

## What this spec is not

- It is not a full reproduction protocol — it covers the verdict
  surface, not how the reproduction itself is constructed (that is
  per-layer convention, documented in the layer READMEs:
  [Layer 1](https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm),
  [Layer 2](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker),
  [Layer 3](https://github.com/aletheia-works/vivarium/tree/main/src/layer3_thirdway)).
- It is not stable across major versions; v1 is locked, v2 will be
  a new spec page when it lands.

## See also

- [Architecture](../architecture.md) — how the three layers relate.
- [AI workflow](../ai-workflow.md) — how AI delegation interacts
  with the contract (CodeRabbit / Dosu replacement / CI agents
  consume the verdict surface, not the per-layer internals).
- [Roadmap](../roadmap.md) — Phase 5 (Ecosystem) is where the
  contract is exported to make industry-standard framing possible.
