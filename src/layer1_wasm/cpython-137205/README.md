# Reproduction — python/cpython#137205

> Phase 1 reproduction page — third entry in Vivarium's Layer 1
> Pyodide gallery and the first to exercise SQLite via the Python
> `sqlite3` stdlib module. Conforms to `vivarium-contract: v1`.

## The bug

[python/cpython#137205](https://github.com/python/cpython/issues/137205)
— On a `sqlite3.Connection` opened with `autocommit=False`,
`PRAGMA foreign_keys = ON` is silently a no-op. The same PRAGMA on
a second connection opened with `autocommit=True` takes effect, so
two connections that should have identical FK enforcement disagree:

```python
import sqlite3
off = sqlite3.connect(":memory:", autocommit=False)
off.execute("PRAGMA foreign_keys = ON")
off.commit()

on = sqlite3.connect(":memory:", autocommit=True)
on.execute("PRAGMA foreign_keys = ON")

off.execute("PRAGMA foreign_keys").fetchone()[0]  # => 0  (BUG)
on.execute("PRAGMA foreign_keys").fetchone()[0]   # => 1
```

## Why this bug

- Python stdlib only — no third-party packages, no I/O beyond the
  in-memory SQLite connection.
- Verdict reduces to a boolean — the two connections disagree on
  the PRAGMA value — so the page emits a mechanically-distinguishable
  `pass` / `fail`.
- Reported against Python 3.13. Related upstream PRs are doc-only;
  Pyodide v0.29.3 ships Python 3.13.2 (and SQLite 3.39.0 via the
  `sqlite3` Pyodide package), which still exhibits the behaviour.
- Demonstrates that Vivarium handles standard-library bugs (not just
  numerical-library bugs), and adds the **sqlite** vertical that
  [`docs/roadmap.md`](../../docs/docs/roadmap.md) lists as a
  Phase 1 deliverable.

## A note on "SQLite-WASM"

This page does **not** load
[`sqlite-wasm`](https://sqlite.org/wasm/) — it loads Pyodide and
exercises SQLite through the Python stdlib `sqlite3` module. In
Pyodide, `sqlite3` is unvendored from the stdlib and ships as a
separately-loadable package; the runtime that actually runs is the
SQLite baked into that package (3.39.0 at the time of writing).
A future page may load `sqlite-wasm` directly to reproduce
SQLite-only bugs that surface beneath the Python binding; this
entry covers the binding-layer bug, which only reproduces through
the Python API surface.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`   | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. The bug is in the CPython binding layer, so no third-party deps are needed (PEP 723 `dependencies = []`). See "Native verification" below. |

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The `result` field
of the envelope reports `off_autocommit_fk`, `on_autocommit_fk`, and
`fk_disagreement`.

A `pass` means **the bug reproduced** (the two connections disagree
on the PRAGMA value). A `fail` means either the runtime ships a fix
(both connections agree), or the runtime errored before producing a
result.

## Running locally — in-browser

```bash
cd src/layer1_wasm
bun install
bun run build
python -m http.server -d . 8767
# open http://localhost:8767/cpython-137205/
```

## Native verification — same reproduction under a real CPython

The companion `repro.py` script reproduces the bug without any
WASM layer. The bug lives in the CPython `sqlite3` binding layer,
not in libsqlite3 itself, so no third-party packages are needed.
The `.mise.toml` at the repo root pins Python to 3.13:

```bash
mise install
mise exec uv -- uv run src/layer1_wasm/cpython-137205/repro.py
# verdict=pass — autocommit=False silently drops PRAGMA foreign_keys
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/cpython-137205/` by
the `deploy-docs` workflow.
