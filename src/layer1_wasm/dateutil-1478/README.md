# Reproduction — dateutil/dateutil#1478

> **Status**: Layer 1 reproduction page. Uses the shared
> [`_shared/`](../_shared/) helpers and TypeScript toolchain, and emits
> the canonical `vivarium-contract: v1` surface.

## The bug

[dateutil/dateutil#1478](https://github.com/dateutil/dateutil/issues/1478)
— `dateutil.parser.parse` inverts the sign of a numeric UTC offset
whenever the offset is preceded by the literal `UTC` prefix:

```python
>>> from dateutil.parser import parse
>>> parse('2026-03-11 14:32:45 UTC-4').isoformat()
'2026-03-11T14:32:45+04:00'   # expected: -04:00
>>> parse('2026-03-11 14:32:45 UTC+4').isoformat()
'2026-03-11T14:32:45-04:00'   # expected: +04:00
```

Bare ISO 8601 forms (`+04:00` / `-04:00` without the `UTC` prefix)
parse correctly, so the inversion is isolated to the `UTC` +
signed-offset code path. Both the short (`-4`) and the long
(`-04:00`) shapes trigger the bug.

## Why this bug

- Five-line reproduction, single library dependency.
- Verdict is a mechanical sign comparison — every UTC±N input is
  checked against the offset its label literally encodes.
- python-dateutil is pure Python, so the bug reproduces under
  Pyodide with no runtime carve-outs (no I/O, no real filesystem,
  no native extensions).
- Reported against python-dateutil 2.9.0.post0 — the latest release
  at authoring time — which the page pins via `micropip.install`.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. Renders baseline + fix-candidate output panes side-by-side. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. Drives the two-variant run (baseline `micropip` install → fix-candidate wheel install via `./wheels/manifest.json` → baseline restore for `enableRunner`). |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`   | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. See "Native verification" below. |
| `fix-candidate.json` | **Tracked.** Single source of truth for the fix branch the page renders alongside the baseline (fork repo URL + branch ref). Read by `scripts/build-layer1-wheels.sh`. |
| `wheels/`    | Generated; gitignored. `mise run repro:build:wheels` (`scripts/build-layer1-wheels.sh`) builds `python_dateutil-<version>-py2.py3-none-any.whl` from `fix-candidate.json` plus a `manifest.json` (filename + version + resolved commit + spec). `repro.ts` fetches the manifest at page load to install the fix candidate in the same Pyodide tab. |
| `roundtrip.json` | Tracked workflow state (round-trip schema_version 1). Updated as the recipe moves through verify → Vivarium PR → fork+fix → upstream PR. |

Shared visual presentation lives in [`../_shared/style.css`](../_shared/style.css).

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts):

- `<meta name="vivarium-contract" content="v1">` declared in `<head>`.
- `document.querySelector('#verdict').dataset.verdict` ∈
  `{"pending", "reproduced", "unreproduced"}`.
- `globalThis.__VIVARIUM_VERDICT__` — mirror of the DOM verdict.
- `globalThis.__VIVARIUM_RESULT__` — a `VivariumResultV1` envelope:
  `{ contract: "v1", bug: { project: "dateutil", issue: 1478, upstream_url },
  runtime: { name: "pyodide", version, extras: { python, "python-dateutil", "python-dateutil_fix_candidate"? } },
  result: { cases, inverted_count, case_count, reproduced, baseline: {...},
  fix_candidate: {...} | null }, timing }`. The top-level `cases` /
  `inverted_count` / `reproduced` mirror the **baseline** variant
  (Contract v1 single-verdict surface preserved); the additive
  `baseline` / `fix_candidate` sub-objects describe each variant.
- Visible verdict text starts with `bug reproduced` or
  `bug not reproduced`.

A `reproduced` verdict means **every** `UTC±N` input landed on the
negated offset — the sign-inversion bug is present end-to-end. An
`unreproduced` verdict means at least one case parsed with the
correct sign (likely a partial or complete upstream fix), or the
runtime errored before producing a result.

## Running locally — in-browser

```bash
# 1. From src/layer1_wasm/, build the TypeScript sources once.
cd src/layer1_wasm
bun install        # one-time per machine / lockfile change
bun run build      # emits repro.js next to repro.ts (gitignored)

# 2. Serve this directory.
python -m http.server -d dateutil-1478 8765
# then open http://localhost:8765/
```

Pyodide does **not** require COOP/COEP headers for this page (no
`SharedArrayBuffer`, no threading), so a plain server is enough.

## Native verification — same reproduction under a real CPython + dateutil

The companion `repro.py` script reproduces the bug without any
WASM layer, so a contributor can confirm the gallery page is
catching a *real* upstream behaviour rather than a Pyodide quirk.
PEP 723 inline metadata pins **`python-dateutil==2.9.0.post0`** —
the version reported as exhibiting the bug — and the `mise.toml`
at the repo root pins Python:

```bash
# One-time per machine / mise.toml change.
mise install

# Reproduces the bug; exits 0 on `reproduced`. uv reads the inline
# metadata, builds an ephemeral venv, and runs the script.
mise exec uv -- uv run src/layer1_wasm/dateutil-1478/repro.py

# Expected output (python-dateutil 2.9.0.post0):
# {
#   "dateutil_version": "2.9.0.post0",
#   "python_version": "3.13.x",
#   "cases": [
#     { "input": "UTC-4",     "expected_offset_seconds": -14400, "actual_offset_seconds":  14400, "inverted": true },
#     { "input": "UTC+4",     "expected_offset_seconds":  14400, "actual_offset_seconds": -14400, "inverted": true },
#     { "input": "UTC-04:00", "expected_offset_seconds": -14400, "actual_offset_seconds":  14400, "inverted": true },
#     { "input": "UTC+04:00", "expected_offset_seconds":  14400, "actual_offset_seconds": -14400, "inverted": true }
#   ],
#   "inverted_count": 4,
#   "case_count": 4,
#   "reproduced": true
# }
# verdict=reproduced — every UTC±N input parsed to its negated offset
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/dateutil/1478/` by the
`deploy-docs` workflow. The workflow runs `bun install` + `bun run
build` in `src/layer1_wasm/` first so the compiled `repro.js` exists
when the bundling step copies the directory into the Pages artefact.
