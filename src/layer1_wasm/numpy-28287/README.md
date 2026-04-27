# Reproduction — numpy/numpy#28287

> Phase 1 reproduction page. The second entry in Vivarium's gallery,
> conforming to `vivarium-contract: v1` like every other Phase 1 page.

## The bug

[numpy/numpy#28287](https://github.com/numpy/numpy/issues/28287) —
NumPy's `timedelta64` ordering is non-transitive when one of the values
uses the *generic* unit. With:

```python
x = np.timedelta64(1, "ms")
y = np.timedelta64(2)        # generic unit, no resolution attached
z = np.timedelta64(5, "ns")
```

NumPy reports `x < y` and `y < z` but `x > z` — strict ordering operators
are supposed to be transitive, so a comparison chain that visibly
contradicts itself is a clear violation.

## Why this bug

- Three-line reproduction (plus an import), zero non-numpy dependencies.
- Verdict is a boolean — `(x < y) ∧ (y < z) ∧ ¬(x < z)` — so the page
  emits a mechanically-distinguishable `pass` / `fail`.
- Reported against numpy 2.2.2; no merged fix as of this writing.
  Pyodide v0.29.3 ships numpy 2.2.5 as an installable package (loaded
  via `loadPyodide({ packages: ["numpy"] })`), so the bug is expected
  to reproduce on the build the page loads.
- Pure NumPy, no I/O, no network, no FFI — nothing in the repro path
  touches a browser-restricted surface.
- Demonstrates that Vivarium's Phase 1 gallery is not pandas-only:
  numpy is in scope as a first-class Layer 1 reproduction target.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`   | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. See "Native verification" below. |

Shared visual presentation lives in [`../_shared/style.css`](../_shared/style.css).

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts):

- `<meta name="vivarium-contract" content="v1">` declared in `<head>`.
- `document.querySelector('#verdict').dataset.verdict` ∈
  `{"pending", "pass", "fail"}`.
- `globalThis.__VIVARIUM_VERDICT__` — mirror of the DOM verdict.
- `globalThis.__VIVARIUM_RESULT__` — a `VivariumResultV1` envelope:
  `{ contract: "v1", bug: { project: "numpy", issue: 28287, upstream_url },
  runtime: { name: "pyodide", version, extras: { python, numpy } },
  result: { x_lt_y, y_lt_z, x_lt_z, transitivity_violated }, timing }`.
- Visible verdict text starts with `reproduction succeeded` or
  `reproduction failed`.

A `pass` means **the bug reproduced** (NumPy still reports the
non-transitive ordering). A `fail` means either the bug was fixed in the
version Pyodide currently ships, or the runtime itself errored before
producing a result.

## Running locally — in-browser

```bash
# 1. From src/layer1_wasm/, build the TypeScript sources once.
cd src/layer1_wasm
bun install        # one-time per machine / lockfile change
bun run build      # emits numpy-28287/repro.js next to repro.ts (gitignored)

# 2. Serve the parent directory so ../_shared/ resolves at runtime.
python -m http.server -d . 8767
# then open http://localhost:8767/numpy-28287/
```

Pyodide does not require COOP/COEP headers (no `SharedArrayBuffer`, no
threading), so a plain server is enough.

## Native verification — same reproduction under a real CPython + NumPy

The companion `repro.py` script reproduces the bug without any
WASM layer. PEP 723 inline metadata pins **`numpy==2.2.5`** — the
exact version Pyodide v0.29.3 bundles — and the `.mise.toml` at the
repo root pins Python to 3.13:

```bash
mise install
mise exec uv -- uv run src/layer1_wasm/numpy-28287/repro.py
# verdict=pass — timedelta64 ordering is non-transitive
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/numpy-28287/` by the
`deploy-docs` workflow. The workflow runs `bun install` + `bun run
build` in `src/layer1_wasm/` first so the compiled `repro.js` exists
when the bundling step copies the directory into the Pages artefact.
