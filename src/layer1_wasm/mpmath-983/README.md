# Reproduction — mpmath/mpmath#983

> Layer 1 reproduction page — installs mpmath via `micropip` and
> runs the same probe against both the released PyPI build and a
> fork-branch fix-candidate wheel in one Pyodide tab. Conforms to
> `vivarium-contract: v1`.

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
| `index.html`               | Static page; declares `<meta name="vivarium-contract" content="v1">`. Output column opts into the multi-variant layout via `vh-output-multi` — two `<pre>` panels share the column's remaining height (flex 50/50), each preceded by an `<h2>` heading. The chrome.js loading overlay stacks on top of the baseline `<pre>` so the column height stays constant from load to post-run (CLS-safe). |
| `repro.ts`                 | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Runs the same reproduction script against the **baseline** mpmath (PyPI 1.4.1) and then against the **fix-candidate** wheel under `./wheels/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`                 | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`                 | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. PEP 723 inline metadata pins `mpmath==1.4.1`. |
| `verify_fix.py`            | **Native CLI orchestrator.** Two-variant fix verification — runs the same reproduction against PyPI 1.4.1 and against the fork branch via `uv run --with`, prints a single JSON envelope. Maintainer convenience tool; not part of Contract v1. |
| `fix-candidate.json`       | **Tracked input** — hand-curated spec of the upstream fork + branch the fix-candidate wheel should be built from (`{ package, source: { url, ref }, upstream_pr? }`). Editing this file is the only step required to refresh the fix candidate. |
| `wheels/<file>.whl`        | **Generated, gitignored** — fix-candidate mpmath wheel, built from `fix-candidate.json` by `scripts/build-layer1-wheels.sh` (run by CI on every deploy and locally via `mise run repro:build:wheels`). Same-origin install lets `micropip` pull it without depending on PyPI to ship the fix. |
| `wheels/manifest.json`     | **Generated, gitignored** — wheel filename + version + resolved commit SHA + `fetched_at`. Written by the same builder; read by `repro.ts` before calling `micropip.install`. |

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The top-level
`#verdict` pill and the `__VIVARIUM_VERDICT__` global both mirror the
**baseline** variant — the same single-verdict surface this page
shipped before the fix-candidate panel was added, so any downstream
consumer that just reads `data-verdict` keeps its prior meaning.
There is **no per-variant verdict pill** in the page DOM: the
fix-candidate panel intentionally does not surface a separate
"unreproduced" pill, since the contract's red `unreproduced` colour
would mis-cue a successful fix as a failure (the fix candidate
*should* not reproduce — that is the desired outcome). Visitors
read each variant's outcome from the JSON inside its own `<pre>`
(`asymmetry: true|false`, `qr_solve_raised`, `lu_solve_succeeded`).

The `result` field of `__VIVARIUM_RESULT__` keeps the existing
`mp_dps` / `qr_solve_raised` / `lu_solve_succeeded` / `asymmetry`
fields and additively gains `result.baseline` and
`result.fix_candidate`, with each variant's own verdict + parsed
mpmath version.

A `reproduced` verdict means **the bug reproduced** in that variant —
`qr_solve` raised AND `lu_solve` succeeded on the same system. An
`unreproduced` verdict means either the asymmetry collapsed
(qr_solve accepted the system, or lu_solve also failed), or the
runtime errored before producing a result.

## Two-variant fix verification

The page installs and runs **two** mpmath builds in the same Pyodide
tab so visitors can see the bug reproducing under PyPI 1.4.1 and
disappearing under the fork-branch fix candidate in one page load:

| Variant         | Source                                                   | Expected outcome |
| --------------- | -------------------------------------------------------- | ---------------- |
| `baseline`      | `mpmath==1.4.1` from PyPI                                | `asymmetry: true` |
| `fix-candidate` | Wheel under `./wheels/`, built from the fork branch [`JamBalaya56562/mpmath@claude/fix-mpmath-issue-983-y1k7X`](https://github.com/JamBalaya56562/mpmath/tree/claude/fix-mpmath-issue-983-y1k7X). | `asymmetry: false` |

The two runs share the same Pyodide instance — between variants the
runtime calls `micropip.uninstall("mpmath")`, drops `mpmath*` from
`sys.modules`, then `micropip.install(<next variant spec>)`. After
both variants finish, the runtime is restored to baseline so the
visitor-facing **Run / Edit** runner (Path A) operates against the
buggy mpmath (its documented mental model).

Once the upstream PR merges and a fixed mpmath release lands on
PyPI, bump the pin in `repro.py` / `repro.ts` and **delete the
`./wheels/` directory** + the fix-candidate code path — the canonical
single-variant page will flip on its own and the two-variant scaffold
becomes redundant.

### Updating the fix-candidate wheel

The wheel is built from
[`fix-candidate.json`](./fix-candidate.json) — a one-screen JSON
spec of the upstream fork + branch. To refresh the fix candidate
(e.g. fork branch advanced, or the fix moved to a different fork),
edit only that file:

```jsonc
{
  "schema_version": 1,
  "package": "mpmath",
  "purpose": "fix-candidate verification for mpmath/mpmath#983",
  "source": {
    "type": "git",
    "url": "https://github.com/<fork>/mpmath",
    "ref": "<branch>"
  },
  "upstream_pr": "https://github.com/mpmath/mpmath/pull/<n>"
}
```

CI (`deploy-docs` workflow) builds the wheel from that spec on
every push to `main` via `scripts/build-layer1-wheels.sh` and
ships it in the Pages artefact alongside the recipe page. The
generated `wheels/<file>.whl` and `wheels/manifest.json` are
gitignored — they never need to land in a PR.

For local development:

```bash
mise install                          # one-time
mise run repro:build:wheels           # writes wheels/<file>.whl + manifest.json (gitignored)
```

Verify both variants natively before pushing:

```bash
mise exec uv -- uv run src/layer1_wasm/mpmath-983/verify_fix.py
# verdict=fix-candidate-confirmed — baseline still reproduces and
#   the fix candidate no longer flags the well-conditioned system as singular.
```

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
