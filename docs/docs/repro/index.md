# Reproductions

Each card below is a real bug from a real upstream project, reproduced
in your browser via Pyodide. Click "Open" to load the page; the verdict
appears at the top once the runtime finishes loading and the
reproduction script has run.

## Vivarium contract

Every page on this gallery satisfies **`vivarium-contract: v1`**:

- `<meta name="vivarium-contract" content="v1">` declared in `<head>`.
- A DOM element with `id="verdict"` and `data-verdict="pending" |
  "pass" | "fail"`.
- Globals `__VIVARIUM_VERDICT__` (mirror) and `__VIVARIUM_RESULT__`
  (structured envelope with `bug`, `runtime`, `result`, `timing`).
- Visible verdict text starting with `reproduction succeeded` or
  `reproduction failed`.

A `pass` verdict means **the bug reproduced** — the upstream behaviour
is observable in the runtime this page just loaded. A `fail` verdict
means the runtime ships a fixed version, or the runtime errored before
producing a result. The semantics are counterintuitive in isolation
but match the project's domain noun: a *reproduction* succeeds when it
reproduces.

## Layer 1 — Pyodide

| Project | Issue | Verdict | |
| --- | --- | --- | --- |
| pandas | [#56679](https://github.com/pandas-dev/pandas/issues/56679) — empty `Series` / `DataFrame` dtype mismatch | `pass` (bug reproduces) | [Open ↗](https://aletheia-works.github.io/vivarium/repro/pandas-56679/) |
| numpy | [#28287](https://github.com/numpy/numpy/issues/28287) — `timedelta64` ordering is non-transitive across generic units | `pass` (bug reproduces) | [Open ↗](https://aletheia-works.github.io/vivarium/repro/numpy-28287/) |
| cpython | [#137205](https://github.com/python/cpython/issues/137205) — `sqlite3` silently drops `PRAGMA foreign_keys = ON` under `autocommit=False` | `pass` (bug reproduces) | [Open ↗](https://aletheia-works.github.io/vivarium/repro/cpython-137205/) |

The Verdict column reflects what the page reports on the runtime
Vivarium currently loads (Pyodide v0.29.3 with Python 3.13.2, pandas
2.3.3, numpy 2.2.5, and SQLite 3.39.0 from the `sqlite3` Pyodide
package at the time of writing). The linked page is authoritative —
visit it to confirm the live verdict, since an upstream fix landing
in a future Pyodide release will flip the verdict to `fail`.

## Adding a reproduction

A new reproduction page lives under
[`src/layer1_wasm/<project>-<issue>/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm)
and ships:

- `index.html` declaring the contract version, with a `#verdict` band
  and `<script src="./repro.js">`.
- `repro.ts` that imports `loadVivariumPyodide`, `setVerdict`,
  `setResult` from
  [`../_shared/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm/_shared)
  and publishes a `VivariumResultV1` envelope on completion.
- A short `README.md` explaining the bug and the verdict criterion.

The deploy workflow handles bundling and the `.ts` → `.js` build —
contributors only edit TypeScript sources.
