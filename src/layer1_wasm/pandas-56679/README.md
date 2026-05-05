# Reproduction — pandas-dev/pandas#56679

> **Status**: Phase 1 reproduction page. Originally Vivarium's Phase 0
> hand-coded PoC; retrofitted onto the [`_shared/`](../_shared/) helpers
> and TypeScript toolchain so it consumes the canonical `vivarium-contract: v1`
> surface like every other Phase 1 page.

## The bug

[pandas-dev/pandas#56679](https://github.com/pandas-dev/pandas/issues/56679)
— `pd.Series([])` returns dtype `object`, but
`pd.DataFrame({'a': []})['a']` returns dtype `float64`. The two
constructors should produce a consistent dtype for an empty input.

## Why this bug

Originally selected as Phase 0's "easiest to debug at a glance" PoC:

- Three-line reproduction, zero non-pandas dependencies.
- Verdict is a `dtype` comparison — a single boolean — so the page emits
  a mechanically-distinguishable `reproduced` / `unreproduced` value.
- Reported against pandas 2.1.4; verified on pandas 2.3.3, which is the
  version Pyodide v0.29.3 ships. The bug is expected to reproduce on the
  same Pyodide build the page loads.
- Pure pandas core — no I/O, no Arrow, no plotting, no thread-scheduler
  dependence. Nothing in the repro path touches a browser-restricted
  surface.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`   | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. See "Native verification" below. |

Shared visual presentation lives in [`../_shared/style.css`](../_shared/style.css);
this directory no longer carries its own copy.

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts):

- `<meta name="vivarium-contract" content="v1">` declared in `<head>`.
- `document.querySelector('#verdict').dataset.verdict` ∈
  `{"pending", "reproduced", "unreproduced"}`.
- `globalThis.__VIVARIUM_VERDICT__` — mirror of the DOM verdict.
- `globalThis.__VIVARIUM_RESULT__` — a `VivariumResultV1` envelope:
  `{ contract: "v1", bug: { project: "pandas", issue: 56679, upstream_url },
  runtime: { name: "pyodide", version, extras: { python, pandas } },
  result: { series_dtype, df_dtype, mismatch }, timing }`.
- Visible verdict text starts with `bug reproduced` or
  `bug not reproduced`.

A `reproduced` verdict means **the bug reproduced** (the
Pyodide-bundled pandas still exhibits the inconsistency). An
`unreproduced` verdict means either the bug was fixed in the version
Pyodide currently ships, or the runtime itself errored before
producing a result.

## Running locally — in-browser

```bash
# 1. From src/layer1_wasm/, build the TypeScript sources once.
cd src/layer1_wasm
bun install        # one-time per machine / lockfile change
bun run build      # emits repro.js next to repro.ts (gitignored)

# 2. Serve this directory.
python -m http.server -d pandas-56679 8765
# then open http://localhost:8765/
```

Pyodide does **not** require COOP/COEP headers for this page (no
`SharedArrayBuffer`, no threading), so a plain server is enough.

## Native verification — same reproduction under a real CPython + pandas

The companion `repro.py` script reproduces the bug without any
WASM layer, so a contributor can confirm the gallery page is
catching a *real* upstream behaviour rather than a Pyodide quirk.
PEP 723 inline metadata pins **`pandas==2.3.3`** — the exact
version Pyodide v0.29.3 bundles — and the `.mise.toml` at the repo
root pins Python to 3.13:

```bash
# One-time per machine / .mise.toml change.
mise install

# Reproduces the bug; exits 0 on `reproduced`. uv reads the inline
# metadata, builds an ephemeral venv, and runs the script.
mise exec uv -- uv run src/layer1_wasm/pandas-56679/repro.py

# Expected output (pandas 2.3.3):
# {
#   "pandas_version": "2.3.3",
#   "python_version": "3.13.x",
#   "series_dtype": "object",
#   "df_dtype": "float64",
#   "mismatch": true,
#   "reproduced": true
# }
# verdict=reproduced — Series and DataFrame disagree on empty-input dtype
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/pandas-56679/` by the
`deploy-docs` workflow. The workflow runs `bun install` + `bun run
build` in `src/layer1_wasm/` first so the compiled `repro.js` exists
when the bundling step copies the directory into the Pages artefact.

Legacy URL `https://aletheia-works.github.io/vivarium/poc/pandas-56679/`
is preserved by an HTML meta-refresh redirect generated at deploy
time, so external links from before the URL migration continue to
work.

## Verification status

### Machine-verified (Claude Preview MCP, Chromium-based engine)

- The page parses, loads
  `https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs`, and
  successfully preloads pandas.
- `__VIVARIUM_RESULT__` envelope on the page (post-retrofit):
  `{ contract: "v1", bug: { project: "pandas", issue: 56679, ... },
  runtime: { name: "pyodide", version: "0.29.3", extras: { python: "3.13.2",
  pandas: "2.3.3" } }, result: { series_dtype: "object", df_dtype: "float64",
  mismatch: true }, ... }`.
- `data-verdict="reproduced"`, visible text `bug reproduced — Series
  dtype ≠ DataFrame dtype.`, `__VIVARIUM_VERDICT__ === "reproduced"`.
- No console errors.

### Needs a human check

Carried over from the Phase 0 PoC, still applicable post-retrofit:

1. **Cross-browser** — confirmation in current Firefox and Safari, in
   addition to the Chromium engine that Preview MCP drives. Pyodide
   advertises support, but Safari has historically differed on
   `SharedArrayBuffer` / COOP-COEP defaults; this PoC does not use
   threading so it should be unaffected, but only a real run on each
   engine can prove it.
2. **First-visit load on typical broadband** — local measurement is not
   representative of CDN latency to a real visitor. A run from a
   residential connection (no proxy / dev tools throttling disabled) is
   what is needed.

The page is wired so a human's confirmation can be quick: open it, wait,
and read the verdict band. No console interaction needed.
