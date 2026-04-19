# ADR-0002: Adopt three-layer architecture

## Status

Accepted

## Context

Building on the problem-centred framing in ADR-0001, no single
technology covers the full reproduction problem space. Algorithmic
bugs in pure-Python code are best reproduced in-browser via
WebAssembly (milliseconds to start, no server cost). Network-dependent
bugs require real filesystems and real sockets, which only
containerised or VM-level environments provide. Deterministic replay
requires techniques neither WASM nor Docker can offer.

Committing to a single layer would permanently exclude the bugs that
layer cannot reach — reintroducing the tech-anchor problem ADR-0001
exists to avoid.

## Decision

Vivarium's reproduction capabilities are organised into three layers:

- **Layer 1 — WebAssembly.** Browser-native, instant startup.
  Covers algorithms, data processing, parsers, in-memory databases.
- **Layer 2 — Docker / microVM.** Full-fidelity environment.
  Covers arbitrary projects and network-dependent scenarios.
- **Layer 3 — Third-way.** Record-replay, deterministic simulation,
  snapshot-based restoration. Covers what Layers 1 and 2 cannot
  reach.

A reproduction request is routed to the layer whose tradeoffs fit
the problem. Users do not pick a layer.

## Consequences

### Positive

- Each layer can mature on its own timeline without blocking the
  others.
- New techniques (WASI Preview 3, post-Firecracker, future research)
  slot into the existing frame rather than requiring architectural
  rewrites.
- Honest coverage claim: we can say "reproducible" for a wider
  category than any single-layer player can.

### Negative

- Higher architectural surface area. Routing and layer-selection
  become load-bearing components we must design well.
- Engineering budget spreads across three stacks rather than one.
- Roadmap is longer than a single-layer product.

## Alternatives considered

- **WASM-only:** excludes most network- and process-level bugs.
- **Docker-only:** duplicates Codespaces, loses the instant-start
  advantage that makes Issue-URL reproduction viable.
- **Record-replay-only:** research-grade tooling; years of
  maturation needed before mass adoption.

## References

- ADR-0001 — Adopt problem-centred framing (parent decision).
- `docs/VISION.md` — public-facing layer description.
- `docs/ARCHITECTURE.md` — technical design (when written).
