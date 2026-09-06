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
  emits a mechanically-distinguishable `reproduced` / `unreproduced`.
- Reported against numpy 2.2.2; no merged fix as of this writing.
  Still reproduces on numpy 2.5.2, the latest release. Pyodide
  v314.0.6 ships numpy 2.4.6 as an installable package (loaded via
  `loadPyodide({ packages: ["numpy"] })`), and reproduces there too.
- Pure NumPy, no I/O, no network, no FFI — nothing in the repro path
  touches a browser-restricted surface.
- Demonstrates that Vivarium's Phase 1 gallery is not pandas-only:
  numpy is in scope as a first-class Layer 1 reproduction target.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`   | **Main-thread driver.** Calls `startPyodideWorker` from [`../_shared/pyodide-worker-client.ts`](../_shared/pyodide-worker-client.ts), which spawns the shared Pyodide worker and relays its progress into the page. Owns the verdict, the Contract v1 envelope and the output pane. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`   | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. See "Native verification" below. |

Shared visual presentation lives in [`../_shared/style.css`](../_shared/style.css).

## Why the runtime lives in a Web Worker

This page ran Pyodide on the main thread longer than its siblings did.
At 2.5 s of total main-thread blocking with a 1.9 s worst task it never
reached the level that had `cpython-137205` and `pandas-56679` offering
to kill the tab, and moving it then would have meant writing a worker
file for a problem nobody had reported. Once the worker moved into
[`../_shared/pyodide-worker.ts`](../_shared/pyodide-worker.ts) that cost
went away, and this page went with it: **2.5 s of blocking became 82 ms**.

The worker is shared by every Pyodide recipe — a recipe does not ship
one of its own, so there is nothing to forget. It imports nothing from
the rest of `../_shared/`: `_shared/verdict.ts` pulls in
`_assets/chrome.js`, which touches `document` at module-evaluation time
and would throw inside a worker. Everything DOM-bound — the verdict
pill, the envelope, the pane, the progress bar — stays on the main
thread.

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts):

- `<meta name="vivarium-contract" content="v1">` declared in `<head>`.
- `document.querySelector('#verdict').dataset.verdict` ∈
  `{"pending", "reproduced", "unreproduced"}`.
- `globalThis.__VIVARIUM_VERDICT__` — mirror of the DOM verdict.
- `globalThis.__VIVARIUM_RESULT__` — a `VivariumResultV1` envelope:
  `{ contract: "v1", bug: { project: "numpy", issue: 28287, upstream_url },
  runtime: { name: "pyodide", version, extras: { python, numpy } },
  result: { x_lt_y, y_lt_z, x_lt_z, transitivity_violated }, timing }`.
- Visible verdict text starts with `bug reproduced` or
  `bug not reproduced`.

A `reproduced` verdict means **the bug reproduced** (NumPy still
reports the non-transitive ordering). An `unreproduced` verdict
means either the bug was fixed in the version Pyodide currently
ships, or the runtime itself errored before producing a result.

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
WASM layer. PEP 723 inline metadata pins **`numpy==2.5.2`** — the
latest release, which is what decides whether the bug is still open —
and the `mise.toml` at the repo root pins Python to 3.14. The page
itself runs whatever numpy Pyodide bundles (2.4.6 today):

```bash
mise install
mise exec uv -- uv run src/layer1_wasm/numpy-28287/repro.py
# verdict=reproduced — timedelta64 ordering is non-transitive
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/numpy/28287/` by the
`deploy-docs` workflow. The workflow runs `bun install` + `bun run
build` in `src/layer1_wasm/` first so the compiled `repro.js` exists
when the bundling step copies the directory into the Pages artefact.
