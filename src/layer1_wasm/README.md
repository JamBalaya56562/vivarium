# Layer 1 — WASM (browser-native)

> Reproduction that runs entirely in the visitor's browser tab.
> Startup: milliseconds to a few seconds. No backend required.

---

## What routes here

- **Algorithmic bugs** — sorting, parsing, text processing, numerical
  edge cases.
- **Data-processing bugs** — pandas/polars shape regressions, SQLite
  query anomalies, serialisation round-trip failures.
- **Library-internal bugs** — pure-Python / pure-Rust / pure-JS logic
  with no system-call dependency.
- **Deterministic reproductions** where the bug does not need a real
  filesystem, network, or process scheduler.

## What does **not** route here

- Anything needing real OS processes, sockets, or devices → Layer 2.
- Anything whose repro depends on specific thread/scheduler interleavings
  or on GDB/rr-style time travel → Layer 3.
- Bugs that only manifest at GB+ data scales (WASM memory cap, browser
  tab practicality) → Layer 2.

## Candidate runtimes

| Language | Runtime                         | Status   |
|----------|---------------------------------|----------|
| Python   | [Pyodide](https://pyodide.org)  | Phase 0 first target |
| SQLite   | [sqlite-wasm](https://sqlite.org/wasm/) | Paired with Pyodide |
| Rust     | `wasm32-wasi` / `wasm32-unknown-unknown` | Deferred |
| Ruby     | [Ruby.wasm](https://github.com/ruby/ruby.wasm) | Deferred |
| PHP      | [php-wasm](https://github.com/WordPress/wordpress-playground) | Deferred |

Concrete runtime choices land in [`docs/`](../../docs/) as ADRs, not
here.

## Phase 0 scope

First vertical is **Pyodide + a hand-picked pandas bug** ([Issue
#13](https://github.com/aletheia-works/vivarium/issues/13)). This
directory will gain its first real files when that Issue lands.
