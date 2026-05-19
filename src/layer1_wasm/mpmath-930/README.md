# Reproduction — mpmath/mpmath#930

> Layer 1 reproduction page. Uses the shared
> [`_shared/`](../_shared/) helpers and TypeScript toolchain, and emits
> the canonical `vivarium-contract: v1` surface.

## The bug

[mpmath/mpmath#930](https://github.com/mpmath/mpmath/issues/930) —
At the default precision (`mp.dps=15`),
`mpmath.jtheta(2, mpc("99","1"), mpc("0.99","0"))` returns roughly
`-1.73e9 + 7.19e8j`. The correct value (verified at `mp.dps=200`,
agreeing with Mathematica) is roughly `-1.50e-57 + 1.13e-58j` —
about 66 orders of magnitude off.

The Jacobi theta function of the second kind sums a series whose
intermediate terms grow exponentially before cancelling. For
arguments with large `Im(z)` and `|q|` close to 1, the default
working precision is too low to track the cancellation, and mpmath
silently returns the uncancelled partial sum instead of either
raising or auto-bumping precision.

## Why this bug

- One-line reproduction (a single `mpmath.jtheta` call), zero
  non-mpmath dependencies beyond the Python stdlib.
- Verdict is a magnitude threshold (`abs(result) > 1e6`) — a single
  boolean — so the page emits a mechanically-distinguishable
  `reproduced` / `unreproduced` value.
- Reported against mpmath 1.3.0; **still reproduces against mpmath
  1.4.1** (the latest PyPI release as of 2026-05-19, locally
  verified). This page pins `mpmath==1.4.1` via micropip so the
  verdict flips only when an upstream fix lands.
- Pure mpmath — no plotting, no FFI, no filesystem. Nothing in the
  repro path touches a browser-restricted surface.

## Files

| File             | Role                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `index.html`     | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`       | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`       | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`       | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. See "Native verification" below. |
| `recipe.json`    | Per-recipe metadata (gallery facets, regression-suite expectations). |
| `roundtrip.json` | Tracked workflow state (round-trip schema_version 1). Updated as the recipe moves through verify → Vivarium PR → fork+fix → upstream PR. |

Shared visual presentation lives in [`../_shared/style.css`](../_shared/style.css);
this directory does not carry its own copy.

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts):

- `<meta name="vivarium-contract" content="v1">` declared in `<head>`.
- `document.querySelector('#verdict').dataset.verdict` ∈
  `{"pending", "reproduced", "unreproduced"}`.
- `globalThis.__VIVARIUM_VERDICT__` — mirror of the DOM verdict.
- `globalThis.__VIVARIUM_RESULT__` — a `VivariumResultV1` envelope:
  `{ contract: "v1", bug: { project: "mpmath", issue: 930, upstream_url },
  runtime: { name: "pyodide", version, extras: { python, mpmath } },
  result: { mp_dps, result_real, result_imag, result_abs, reproduced }, timing }`.
- Visible verdict text starts with `bug reproduced` or
  `bug not reproduced`.

A `reproduced` verdict means **the bug reproduced** (the magnitude
at default precision exceeded `1e6`, indicating mpmath returned the
uncancelled partial sum). An `unreproduced` verdict means either
the bug was fixed in the mpmath wheel micropip currently resolves,
or the runtime itself errored before producing a result.

## Running locally — in-browser

```bash
# 1. From src/layer1_wasm/, build the TypeScript sources once.
cd src/layer1_wasm
bun install        # one-time per machine / lockfile change
bun run build      # emits repro.js next to repro.ts (gitignored)

# 2. Serve the parent directory so ../_shared/ resolves at runtime.
python -m http.server -d . 8769
# then open http://localhost:8769/mpmath-930/
```

Pyodide does not require COOP/COEP headers for this page (no
`SharedArrayBuffer`, no threading), so a plain server is enough.

## Native verification — same reproduction under a real CPython + mpmath

The companion `repro.py` script reproduces the bug without any
WASM layer, so a contributor can confirm the gallery page is
catching a *real* upstream behaviour rather than a Pyodide /
micropip quirk. PEP 723 inline metadata pins **`mpmath==1.4.1`**
and the `mise.toml` at the repo root pins Python to 3.13:

```bash
# One-time per machine / mise.toml change.
mise install

# Reproduces the bug; exits 0 on `reproduced`. uv reads the inline
# metadata, builds an ephemeral venv, and runs the script.
mise exec uv -- uv run src/layer1_wasm/mpmath-930/repro.py

# Expected output (mpmath 1.4.1):
# {
#   "mpmath_version": "1.4.1",
#   "python_version": "3.13.x",
#   "mp_dps": 15,
#   "result_real": -1727079129.2142,
#   "result_imag": 719261908.645394,
#   "result_abs": 1870866112.7390957,
#   "expected_abs_at_dps200": 1.5e-57,
#   "reproduced": true
# }
# verdict=reproduced — jtheta(2, 99+1j, 0.99) returned magnitude 1.871e+09 at dps=15, expected ~1.5e-57.
```

## Round-trip state

`roundtrip.json` tracks the recipe's progress through the round-
trip loop. Stages reflect:

- `status: "draft"` — recipe just scaffolded.
- `status: "verifying"` — `verdicts.unfixed` captured.
- `status: "verified"` — both verdicts captured, the fix actually
  flips the page.
- `status: "upstream_open"` — upstream draft PR opened.
- `status: "merged"` — upstream merged. (Terminal.)
- `status: "blocked"` — any stage failure; reason in `notes[]`.

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/mpmath/930/` by
the `deploy-docs` workflow. The workflow runs `bun install` +
`bun run build` in `src/layer1_wasm/` first so the compiled
`repro.js` exists when the bundling step copies the directory
into the Pages artefact.
