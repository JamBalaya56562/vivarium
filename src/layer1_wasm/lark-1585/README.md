# Reproduction — lark-parser/lark#1585

> **Status**: Layer 1 reproduction page. Uses the shared
> [`_shared/`](../_shared/) verdict helper and TypeScript toolchain,
> and emits the canonical `vivarium-contract: v1` surface.

## The bug

[lark-parser/lark#1585](https://github.com/lark-parser/lark/issues/1585) —
the grammar `start.1: "a" | start start*` puts lark's LALR back-end
(and the CYK back-end) into an infinite loop when
`parser='lalr'`. Earley terminates normally. Without the `.1`
priority on `start`, lark raises `GrammarError` instead — only the
priority-plus-recursive-alt combination triggers the hang.

Upstream label: `bug`. Reporter:
[`acornlaw-skwilinski`](https://github.com/lark-parser/lark/issues/1585)
(filed 2026-03-24).

## Why this bug fits Layer 1

- Lark is pure Python, no C extensions; micropip installs the
  `lark-1.3.1` wheel into Pyodide directly.
- The reproduction is two lines and pinpoints the exact grammar
  shape — easy to render and easy to verify visually.
- Verdict is a simple wall-clock decision: "did the parse return
  within the budget?". A mechanically distinguishable boolean.

The bug is a **hang**, not a wrong result. Running it on the main
thread would freeze the visitor's tab, so the page runs Pyodide +
lark inside a `Worker(..., { type: 'module' })` and the main thread
imposes a wall-clock budget. If the worker does not message back a
result within the budget, the page calls `worker.terminate()` and
sets the verdict to `reproduced`.

## Files

| File              | Role                                                          |
| ----------------- | ------------------------------------------------------------- |
| `index.html`      | Static page; declares `<meta name="vivarium-contract" content="v1">`. Renders baseline + fix-candidate output panes side-by-side. |
| `repro.ts`        | Main-thread driver. Spawns one worker per variant (baseline, then fix-candidate), races each worker's `result` message against an 8-second budget, updates the per-variant pane and the Contract v1 envelope. |
| `repro.worker.ts` | Worker source. Loads Pyodide, installs the lark spec passed via the worker URL's query string (`lark==1.3.1` for baseline, `./wheels/<filename>` for fix-candidate) via micropip, then executes the reproduction inside a `try/except` + timing harness. |
| `repro.js` /      | Generated from the TS sources; gitignored.                    |
| `repro.worker.js` |                                                               |
| `repro.py`        | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. Uses `subprocess` + `TimeoutExpired` so the timeout works on Windows as well as POSIX. |
| `fix-candidate.json` | **Tracked.** Single source of truth for the fix branch the page renders alongside the baseline (fork repo URL + branch ref). Read by `scripts/build-layer1-wheels.sh`. |
| `verify_fix.py`   | **Maintainer convenience.** PEP 723 native orchestrator that runs the reproduction against **both** the baseline pin and the fix-candidate spec in side-by-side `uv run --no-project --with <spec>` venvs, so a reviewer can see the before/after verdict in one command. Exits 0 iff baseline reproduces (hangs past the budget) AND fix-candidate does not. Deleted once the fix is merged upstream and released on PyPI. |
| `wheels/`         | Generated; gitignored. `mise run repro:build:wheels` (`scripts/build-layer1-wheels.sh`) builds `lark-<version>-py3-none-any.whl` from `fix-candidate.json` plus a `manifest.json` (filename + version + resolved commit + spec). `repro.ts` fetches the manifest at page load to install the fix candidate in a second Pyodide worker. |
| `roundtrip.json`  | Tracked workflow state (round-trip schema_version 1).         |

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
  `{ contract: "v1", bug: { project: "lark", issue: 1585, upstream_url },
  runtime: { name: "pyodide", version, extras: { python, lark } },
  result: { outcome, error, elapsed_ms, timeout_ms, reproduced },
  timing }`.

A `reproduced` verdict means the worker did not return a result
within 8 seconds — the infinite loop is confirmed.
An `unreproduced` verdict means the parse returned (bug fixed
upstream) or raised an exception (bug behaviour changed; the
specific hang did not trigger) before the budget elapsed.

## Running locally — in-browser

```bash
# 1. From src/layer1_wasm/, build the TypeScript sources once.
cd src/layer1_wasm
bun install        # one-time per machine / lockfile change
bun run build      # emits repro.js + repro.worker.js next to the .ts sources

# 2. Serve this directory.
python -m http.server -d lark-1585 8765
# then open http://localhost:8765/
```

Pyodide does not require COOP/COEP headers for this page (no
`SharedArrayBuffer`, no shared-memory threading — the Web Worker
runs an entirely independent Pyodide instance).

## Native verification — same reproduction under a real CPython + lark

The companion `repro.py` script reproduces the bug without any
WASM layer, so a contributor can confirm the page is catching a
*real* upstream behaviour rather than a Pyodide / micropip quirk.
PEP 723 inline metadata pins **`lark==1.3.1`** and the `mise.toml`
at the repo root pins Python to 3.13:

```bash
# One-time per machine / mise.toml change.
mise install

# Reproduces the bug; exits 0 on `reproduced`. The script forks a
# subprocess to run the parse and waits up to 8s before declaring
# the bug reproduced.
mise exec uv -- uv run src/layer1_wasm/lark-1585/repro.py

# Expected output (lark 1.3.1):
# {
#   "lark_version": "1.3.1",
#   "python_version": "3.13.x",
#   "outcome": "timeout",
#   "exit_code": null,
#   "stderr_tail": [...],
#   "elapsed_ms": 8000.x,
#   "timeout_ms": 8000.0,
#   "reproduced": true
# }
# verdict=reproduced — Lark(...).parse('aa') hung past 8s; the LALR back-end exhibits the infinite loop reported upstream.
```

## Fix-candidate verification

A fork+branch carrying a proposed fix is rendered **side-by-side**
with the baseline on the same page, so a reviewer can see the
before/after verdict in one page load.

- **Fix branch:**
  <https://github.com/JamBalaya56562/lark/tree/claude/fix-lark-1585-QLVa7>
  (lark ships its installable package at the repo root, so no
  `source.subdirectory` is needed in `fix-candidate.json`).
- **What the page shows:**
  - top right pane (`#output`) — baseline run against PyPI
    `lark==1.3.1` inside its own Pyodide worker. Expected
    `outcome: "timeout"` (the parse hangs past the 8 s budget;
    the worker is then terminated).
  - bottom right pane (`#output-fix`) — fix-candidate run against
    the wheel built from the branch, inside a fresh Pyodide
    worker. Expected `outcome: "returned"` (parse returns a tree
    within the budget).
  - top-level `#verdict` pill mirrors the baseline so the existing
    single-verdict Contract v1 surface keeps its prior meaning.

### Local in-browser

```bash
# Build the fix-candidate wheel into ./wheels/ (gitignored).
mise install
mise run repro:build:wheels

# Then build + serve the recipe directory as usual.
cd src/layer1_wasm
bun install
bun run build
python -m http.server -d lark-1585 8765
# Open http://localhost:8765/ — the page spawns the baseline
# worker first, captures the hang verdict, then fetches
# ./wheels/manifest.json, spawns a second worker that installs the
# wheel via micropip, and re-runs the probe to populate the
# fix-candidate pane.
```

### Native (uv venvs)

```bash
mise install                                                          # one-time
mise exec uv -- uv run src/layer1_wasm/lark-1585/verify_fix.py
# Exits 0 iff baseline reproduces (hang past 8s) AND fix-candidate
# does not. Prints a single JSON envelope to stdout with both
# per-variant verdicts.
```

### Cleanup once the fix lands upstream

When lark releases a wheel that includes this fix on PyPI:

1. Bump the pin in `repro.ts`, `repro.worker.ts`, `repro.py`, and
   the README to the first fixed release (e.g. `lark==1.3.2`).
2. Delete `fix-candidate.json`, `verify_fix.py`, and the
   `wheels/` directory if any local artefacts remain.
3. Revert `index.html` and `repro.ts` to the single-variant layout
   (one `#output` pane, no `vh-output-multi` / `#output-fix`).
4. The recipe page then reports a single `unreproduced` verdict
   against the fixed release — same shape as a freshly-merged
   bug-fix recipe.

## Round-trip state

`roundtrip.json` tracks the recipe's progress through the round-
trip loop (see
[the round-trip guide](https://aletheia-works.github.io/vivarium/guide/round-trip)
for the stage breakdown). Stages reflect:

- `status: "draft"` — recipe just scaffolded.
- `status: "verifying"` — `verdicts.unfixed` captured.
- `status: "verified"` — both verdicts captured, the fix actually
  flips the page.
- `status: "upstream_open"` — upstream draft PR opened.
- `status: "merged"` — upstream merged. (Terminal.)
- `status: "blocked"` — any stage failure; reason in `notes[]`.

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/lark/1585/` by
the `deploy-docs` workflow. The workflow runs `bun install` +
`bun run build` in `src/layer1_wasm/` first so the compiled
`repro.js` + `repro.worker.js` exist when the bundling step
copies the directory into the Pages artefact.
