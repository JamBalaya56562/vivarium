# Reproduction — mpmath/mpmath#983

> Layer 1 reproduction page — installs mpmath via `micropip` and
> runs the probe against the released PyPI build in one Pyodide tab.
> Conforms to `vivarium-contract: v1`.

## The bug

[mpmath/mpmath#983](https://github.com/mpmath/mpmath/issues/983) —
`mp.qr_solve(A, b)` raises `ValueError: matrix is numerically
singular` on a well-conditioned 4×4 polynomial-interpolation system
that `mp.lu_solve(A, b)` handles fine. Wolfram|Alpha confirms the
matrix is invertible (condition number ≈695), so the issue is the
**asymmetry** between the two solvers — qr_solve is wrong on a
matrix that is not actually singular.

```python
from mpmath import mp

A = mp.matrix([
    [mp.one, -mp.pi / 20, (-mp.pi / 20) ** 2, (-mp.pi / 20) ** 3],
    [mp.one, mp.zero, mp.zero, mp.zero],
    [mp.one, mp.pi / 20, (mp.pi / 20) ** 2, (mp.pi / 20) ** 3],
    [mp.one, mp.pi / 10, (mp.pi / 10) ** 2, (mp.pi / 10) ** 3],
])
b = mp.matrix([
    [mp.sin(-mp.pi / 20)],
    [mp.zero],
    [mp.sin(mp.pi / 20)],
    [mp.sin(mp.pi / 20)],
])

mp.qr_solve(A, b)   # ValueError: matrix is numerically singular
mp.lu_solve(A, b)   # returns a finite solution
```

The suspected fix area is the Householder QR guard
`if not abs(s) > ctx.eps:` in
[`mpmath/matrices/linalg.py:333`](https://github.com/mpmath/mpmath/blob/master/mpmath/matrices/linalg.py#L333):
the guard trips on a sub-eps intermediate sum that the LU path
never sees. Lowering precision via `mp.dps = 10` keeps the sum
above the new (looser) eps and works around the bug.

## Why this bug

- Pure Python — mpmath has no runtime dependencies beyond the
  Python stdlib. No native extensions, no I/O, no thread-scheduler
  dependence. Pyodide installs the wheel from PyPI via `micropip`
  in seconds.
- Reproduction is a fixed 4×4 system + two solver calls; verdict
  reduces to a boolean (qr raised AND lu succeeded → bug). The
  page emits a mechanically-distinguishable
  `reproduced` / `unreproduced`.
- Reported against mpmath 1.3.0; latest release at authoring time
  is 1.4.1 (2026-03-15) and the bug still reproduces there. Pinning
  in PEP 723 / `repro.ts` to that exact version locks the verdict
  to a known-bad build, so the page flips to `unreproduced` only
  when a new mpmath release lands an actual fix.
- Demonstrates Vivarium handles **numerical-stability** bugs (a
  category neither `cpython-137205` nor `pandas-56679` exercise)
  while still fitting the Layer 1 envelope.

## Files

| File                       | Role                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `index.html`               | Static page; declares `<meta name="vivarium-contract" content="v1">` and renders the reproduction script plus output panel. |
| `repro.ts`                 | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Installs `mpmath==1.4.1` and runs the reproduction script. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`                 | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`                 | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. PEP 723 inline metadata pins `mpmath==1.4.1`. |

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The `#verdict` pill
and the `__VIVARIUM_VERDICT__` global describe the single PyPI-pinned
run.

The `result` field of `__VIVARIUM_RESULT__` includes
`mp_dps` / `qr_solve_raised` / `lu_solve_succeeded` / `asymmetry`,
plus a `result.baseline` object with the same run's verdict and parsed
mpmath version.

A `reproduced` verdict means **the bug reproduced** in that variant —
`qr_solve` raised AND `lu_solve` succeeded on the same system. An
`unreproduced` verdict means either the asymmetry collapsed
(qr_solve accepted the system, or lu_solve also failed), or the
runtime errored before producing a result.

## Running locally — in-browser

```bash
cd src/layer1_wasm
bun install
bun run build
python -m http.server -d . 8767
# open http://localhost:8767/mpmath-983/
```

The page first preloads `micropip`, then installs `mpmath==1.4.1`
from PyPI on the visitor's machine before running the reproduction.
First-visit cold load is slower than recipes that exercise only
Pyodide-bundled packages.

## Native verification — same reproduction under a real CPython

```bash
mise install
mise exec uv -- uv run src/layer1_wasm/mpmath-983/repro.py
# verdict=reproduced — qr_solve raised on a system lu_solve handles fine
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/mpmath/983/` by the
`deploy-docs` workflow.
