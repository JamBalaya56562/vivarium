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

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`   | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. PEP 723 inline metadata pins `astroid==4.1.2`. |

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The `result` field
of the envelope reports `nested_braces`, `exception_type`, and
`crashed`.

A `reproduced` verdict means **the bug reproduced** —
`astroid.builder.parse` raised an unhandled `MemoryError` /
`RecursionError` (or any non-`AstroidSyntaxError`). An
`unreproduced` verdict means either upstream landed a graceful catch
(`AstroidSyntaxError` or clean return), or the runtime errored
before producing a result.

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
