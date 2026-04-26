# Phase 0 PoC — pandas-dev/pandas#56679

> **Status**: vivarium's first end-to-end "one bug, fully reproduced in the
> browser" milestone. Hand-coded, single-file PoC. Generalisation lives in
> Phase 1, not here.

## The bug

[pandas-dev/pandas#56679](https://github.com/pandas-dev/pandas/issues/56679)
— `pd.Series([])` returns dtype `object`, but
`pd.DataFrame({'a': []})['a']` returns dtype `float64`. The two
constructors should produce a consistent dtype for an empty input.

## Why this bug

Selection criterion: "easiest to debug at a glance" (per Issue #13
unblocking).

- Three-line reproduction, zero non-pandas dependencies.
- Verdict is a `dtype` comparison — a single boolean — so the page can
  emit a mechanically-distinguishable `succeeded` / `failed` string.
- Reported against pandas 2.1.4; verified locally on pandas 2.3.3, which
  is the version Pyodide v0.29.3 ships. So this PoC is expected to
  reproduce on the same Pyodide build that the page loads.
- Pure pandas core — no I/O, no Arrow, no plotting, no thread-scheduler
  dependence. Nothing in the repro path touches a browser-restricted
  surface.

## Files

| File         | Role                                                |
| ------------ | --------------------------------------------------- |
| `index.html` | Static page; the only thing GitHub Pages serves.    |
| `repro.mjs`  | ES module that loads Pyodide, runs the repro, sets the verdict. |
| `style.css`  | Light/dark presentation.                            |

## Verdict contract

For automated harnesses (Playwright, Preview MCP, etc.) the page exposes:

- `document.querySelector('#verdict').dataset.verdict` ∈
  `{"pending", "pass", "fail"}`.
- `globalThis.__VIVARIUM_VERDICT__` — same value, available off the
  global object.
- `globalThis.__VIVARIUM_RESULT__` — the parsed Python result dict
  (`pandas_version`, `series_dtype`, `df_dtype`, `mismatch`) once the
  run finishes.
- The verdict element's text starts with `reproduction succeeded` or
  `reproduction failed`, matching Issue #13's acceptance criterion.

A `pass` means **the bug reproduced** (i.e. the Pyodide-bundled pandas
still exhibits the inconsistency). A `fail` means either the bug was
fixed in the version Pyodide currently ships, or the runtime itself
errored before producing a result.

## Running locally

The page is a static asset — any HTTP server works. From the repo root:

```bash
python -m http.server -d src/layer1_wasm/pandas-56679 8000
# then open http://localhost:8000/
```

Pyodide does **not** require COOP/COEP headers for this PoC (no
`SharedArrayBuffer`, no threading), so a plain server is enough.

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/poc/pandas-56679/` by the
`deploy-docs` workflow, which copies this directory into the rspress
build artifact before upload.

## Verification status

### Machine-verified (Claude Preview MCP, Chromium-based engine)

- The page parses, loads `https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs`,
  and successfully `loadPackage("pandas")`.
- Result dict on the page: `{pandas_version: "2.3.3", python_version:
  "3.13.2", series_dtype: "object", df_dtype: "float64", mismatch: true}`.
- Verdict element resolves to `data-verdict="pass"` and the visible text
  starts with `reproduction succeeded`.
- `globalThis.__VIVARIUM_VERDICT__ === "pass"` and
  `globalThis.__VIVARIUM_RESULT__` is populated.
- Wall-clock first-load time, served from `localhost`: ~20 s on the
  measurement run. The pandas wheel + Pyodide runtime dominate; this
  page is plain HTML/JS. A warm reload was a similar ~20 s — the
  browser used in measurement does not aggressively cache the Pyodide
  CDN responses.

### Needs a human check

Issue #13's acceptance criteria still require:

1. **Cross-browser** — confirmation in current Firefox and Safari, in
   addition to the Chromium engine that Preview MCP drives. Pyodide
   advertises support, but Safari has historically differed on
   `SharedArrayBuffer` / COOP-COEP defaults; this PoC does not use
   threading so it should be unaffected, but only a real run on each
   engine can prove it.
2. **First-visit load on typical broadband** — the localhost-served
   measurement above is not representative of CDN latency to a real
   visitor. A run from a residential connection (no proxy / dev tools
   throttling disabled) is what the issue calls for.

The page is wired so a human's confirmation can be quick: open it,
wait, and read the verdict band. No console interaction needed.
