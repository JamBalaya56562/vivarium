# Reproduction — pylint-dev/astroid#2993

> Layer 1 reproduction page — first entry in Vivarium's Layer 1
> Pyodide gallery to install a third-party Python package via
> `micropip` (astroid is not bundled in Pyodide's package set).
> Conforms to `vivarium-contract: v1`.

## The bug

[pylint-dev/astroid#2993](https://github.com/pylint-dev/astroid/issues/2993)
— `astroid.builder.parse(code)` raises an unhandled `MemoryError`
(or `RecursionError`, depending on the runtime) when fed a fuzzed
type comment whose value is `i` followed by a long run of `{`
characters:

```python
import astroid
code = "a=b # type:i" + "{" * 270
astroid.builder.parse(code)
# MemoryError (or RecursionError) — propagates out of `parse`
```

The fuzzed input is from OSS-Fuzz; the upstream issue references the
internal report at <https://issues.oss-fuzz.com/issues/489780714>.
CPython's compiler walks the type-comment expression recursively and
either runs out of stack or memory; astroid does not catch the
runtime error in its type-comment parser, so the exception
propagates out of `parse` and crashes any tool built on it (pylint,
IDE plugins, etc.).

The expected fix mirrors astroid's #2762 fix for f-strings (shipped
in 4.1.2): catch `MemoryError`/`RecursionError` in the type-comment
parser and treat the comment as opaque.

## Why this bug

- Pure Python — astroid has only one required dependency
  (`typing-extensions`, already bundled by Pyodide). No native
  extensions, no I/O, no thread-scheduler dependence.
- Reproduction is a single `astroid.builder.parse(code)` call;
  verdict reduces to a boolean (did `parse` raise an unhandled
  runtime error or not).
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
| `wheels/<file>.whl`        | Pre-built fix-candidate astroid wheel. Vendored in-repo for now so the page can install it via `micropip` from same-origin (PyPI does not yet ship the fix). A follow-up will move wheel building to CI and publishing to GitHub Pages so the binary leaves the repo (see issue / follow-up PR). |
| `wheels/manifest.json`     | Records which wheel filename / version / source ref the page should install. The runtime fetches this before calling `micropip.install`. |

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
(`crashed: true|false`, `exception_type`).

The `result` field of `__VIVARIUM_RESULT__` keeps the legacy
`nested_braces` / `exception_type` / `crashed` fields and additively
gains `result.baseline` and `result.fix_candidate` sub-objects, each
with that variant's own verdict + parsed astroid version.

A `reproduced` verdict means **the bug reproduced** in that variant —
`astroid.builder.parse` raised an unhandled `MemoryError` /
`RecursionError` (or any non-`AstroidSyntaxError`). An
`unreproduced` verdict means either the variant ships a graceful catch
(`AstroidSyntaxError` or clean return), or the runtime errored
before producing a result.

## Two-variant fix verification

The page installs and runs **two** astroid builds in the same Pyodide
tab so visitors can see the bug reproducing under PyPI 4.1.2 and
disappearing under the in-flight upstream PR in one page load:

| Variant         | Source                                                   | Expected outcome |
| --------------- | -------------------------------------------------------- | ---------------- |
| `baseline`      | `astroid==4.1.2` from PyPI                               | `crashed: true`  |
| `fix-candidate` | Wheel under `./wheels/`, built from the fork branch the upstream PR is opened from. Currently `JamBalaya56562/astroid@claude/fix-astroid-2993-wVitv` (see [PR #1](https://github.com/JamBalaya56562/astroid/pull/1)). | `crashed: false` |

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

When the fork branch advances (or the fix-candidate is moved to a
different fork / branch), regenerate the committed wheel:

```bash
mise install                                                          # one-time
mise exec uv -- uv run --no-project --with pip --python 3.13 -- \
  python -m pip wheel --no-deps \
    --wheel-dir src/layer1_wasm/astroid-2993/wheels \
    "astroid @ git+https://github.com/<fork>/astroid@<branch>"
# Then update src/layer1_wasm/astroid-2993/wheels/manifest.json
# (`filename`, `version`, `source.ref`, `source.commit`, `fetched_at`)
# and delete the old wheel file.
```

Verify both variants natively before pushing:

```bash
mise exec uv -- uv run src/layer1_wasm/astroid-2993/verify_fix.py
# verdict=fix-candidate-confirmed — baseline still reproduces
#   and the fix candidate flips the verdict to unreproduced.
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
# verdict=reproduced — astroid.builder.parse raised MemoryError on a fuzzed type comment
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/astroid/2993/` by
the `deploy-docs` workflow.
