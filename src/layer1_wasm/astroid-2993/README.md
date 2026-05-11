# Reproduction — pylint-dev/astroid#2993

> Layer 1 reproduction page — first entry in Vivarium's Layer 1
> Pyodide gallery to install a third-party Python package via
> `micropip` (astroid is not bundled in Pyodide's package set).
> Conforms to `vivarium-contract: v1`.

## The bug

[pylint-dev/astroid#2993](https://github.com/pylint-dev/astroid/issues/2993)
— `astroid.builder.parse(code)` raises an unhandled `MemoryError`
when fed a fuzzed type comment whose value is `i` followed by a long
run of `{` characters:

```python
import astroid
code = "a = b # type:i" + "{" * 200
astroid.builder.parse(code)
# MemoryError — propagates out of `parse`
```

The fuzzed input is from OSS-Fuzz; the upstream issue references the
internal report at <https://issues.oss-fuzz.com/issues/489780714>.
CPython's compiler walks the type-comment expression recursively and
runs out of memory; astroid 4.1.2 does not cut off pathological
nesting before parsing, so the exception propagates out of `parse`
and crashes any tool built on it (pylint, IDE plugins, etc.).

The expected fix detects pathological nesting before calling Python's
parser, skips the invalid type comment, and still parses deeply nested
but valid type comments.

## Why this bug

- Pure Python — astroid has only one required dependency
  (`typing-extensions`, already bundled by Pyodide). No native
  extensions, no I/O, no thread-scheduler dependence.
- Reproduction is a small set of `astroid.builder.parse(code)` calls:
  assignment and function pathological type comments must not crash
  after the fix, while a deeply nested but valid type comment must
  still parse.
- Reported against astroid 4.1.x. Latest release at authoring time
  is 4.1.2 (2026-03-22) and the bug still reproduces there; pinning
  in PEP 723 / `repro.ts` to that exact version locks the verdict
  to a known-bad build, so the page flips to `unreproduced` only
  when a new astroid release lands an actual fix.
- Demonstrates Vivarium handles bugs in upstream projects whose
  packages are not pre-bundled in Pyodide — the page installs
  astroid from PyPI via `micropip` after the runtime bootstraps.

## Files

| File                       | Role                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `index.html`               | Static page; declares `<meta name="vivarium-contract" content="v1">`. Output column opts into the multi-variant layout via `vh-output-multi` — two `<pre>` panels share the column's remaining height (flex 50/50), each preceded by an `<h2>` heading. The chrome.js loading overlay stacks on top of the baseline `<pre>` so the column height stays constant from load to post-run (CLS-safe). |
| `repro.ts`                 | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Runs the same reproduction script against the **baseline** astroid (PyPI 4.1.2) and then against the **fix-candidate** wheel under `./wheels/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`                 | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`                 | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. PEP 723 inline metadata pins `astroid==4.1.2`. |
| `verify_fix.py`            | **Native CLI orchestrator.** Two-variant fix verification — runs the same reproduction against PyPI 4.1.2 and against the fork branch via `uv run --with`, prints a single JSON envelope. Maintainer convenience tool; not part of Contract v1. |
| `fix-candidate.json`       | **Tracked input** — hand-curated spec of the upstream fork + branch the fix-candidate wheel should be built from (`{ package, source: { url, ref }, upstream_pr }`). Lives at the recipe root (not under `wheels/`) so the same filename can describe a Ruby gem, PHP package, Rust crate, etc. in future non-Python recipes. Editing this file is the only step required to refresh the fix candidate. |
| `wheels/<file>.whl`        | **Generated, gitignored** — fix-candidate astroid wheel, built from `fix-candidate.json` by `scripts/build-layer1-wheels.sh` (run by CI on every deploy and locally via `mise run repro:build:wheels`). Same-origin install lets `micropip` pull it without depending on PyPI to ship the fix. |
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
(`crashed: true|false`, `skipped_pathological`,
`valid_control_parsed`, and per-case details).

The `result` field of `__VIVARIUM_RESULT__` keeps the legacy
`nested_braces` / `exception_type` / `crashed` fields and additively
gains `skipped_pathological`, `valid_control_parsed`, `cases`,
`result.baseline`, and `result.fix_candidate`, with each variant's
own verdict + parsed astroid version.

A `reproduced` verdict means **the bug reproduced** in that variant —
a pathological type comment crashed `astroid.builder.parse`. An
`unreproduced` verdict means the pathological assignment and function
type comments were skipped before parsing and the valid deep-nesting
control still parsed, or the runtime errored before producing a result.

## Two-variant fix verification

The page installs and runs **two** astroid builds in the same Pyodide
tab so visitors can see the bug reproducing under PyPI 4.1.2 and
disappearing under the in-flight upstream PR in one page load:

| Variant         | Source                                                   | Expected outcome |
| --------------- | -------------------------------------------------------- | ---------------- |
| `baseline`      | `astroid==4.1.2` from PyPI                               | `crashed: true`  |
| `fix-candidate` | Wheel under `./wheels/`, built from the fork branch opened as [pylint-dev/astroid#3049](https://github.com/pylint-dev/astroid/pull/3049). Currently `JamBalaya56562/astroid@claude/fix-astroid-2993-wVitv`. | `crashed: false`, `skipped_pathological: true`, `valid_control_parsed: true` |

The two runs share the same Pyodide instance — between variants the
runtime calls `micropip.uninstall("astroid")`, drops `astroid*` from
`sys.modules`, then `micropip.install(<next variant spec>)`. After
both variants finish, the runtime is restored to baseline so the
visitor-facing **Run / Edit** runner (Path A) operates against the
buggy astroid (its documented mental model).

Once the upstream PR merges and a fixed astroid release lands on
PyPI, bump the pin in `repro.py` / `repro.ts` and **delete the
`./wheels/` directory** + the fix-candidate code path — the canonical
single-variant page will flip on its own and the two-variant scaffold
becomes redundant.

### Updating the fix-candidate wheel

The wheel is built from
[`fix-candidate.json`](./fix-candidate.json) — a one-screen JSON
spec of the upstream fork + branch (per ADR-0040). To refresh the
fix candidate (e.g. fork branch advanced, or the fix moved to a
different fork), edit only that file:

```jsonc
{
  "schema_version": 1,
  "package": "astroid",
  "purpose": "fix-candidate verification for pylint-dev/astroid#2993",
  "source": {
    "type": "git",
    "url": "https://github.com/<fork>/astroid",
    "ref": "<branch>"
  },
  "upstream_pr": "https://github.com/<fork>/astroid/pull/<n>"
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
mise exec uv -- uv run src/layer1_wasm/astroid-2993/verify_fix.py
# verdict=fix-candidate-confirmed — baseline still reproduces and
#   the fix candidate skips pathological type comments before parsing.
```

## Running locally — in-browser

```bash
cd src/layer1_wasm
bun install
bun run build
python -m http.server -d . 8767
# open http://localhost:8767/astroid-2993/
```

The page first preloads `micropip`, then installs `astroid==4.1.2`
from PyPI on the visitor's machine before running the reproduction.
First-visit cold load is slower than recipes that exercise only
Pyodide-bundled packages.

## Native verification — same reproduction under a real CPython

```bash
mise install
mise exec uv -- uv run src/layer1_wasm/astroid-2993/repro.py
# verdict=reproduced — astroid.builder.parse raised MemoryError on a pathological type comment
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/astroid/2993/` by
the `deploy-docs` workflow.
