# Layer 1 — WASM (browser-native)

> Reproduction that runs entirely in the visitor's browser tab.
> Startup: milliseconds to a few seconds. No backend required.

---

## What routes here

- **Algorithmic bugs** — sorting, parsing, text processing, numerical
  edge cases.
- **Data-processing bugs** — pandas/polars shape regressions, SQLite
  query anomalies, serialisation round-trip failures.
- **Library-internal bugs** — pure-Python / pure-Rust / pure-JS logic
  with no system-call dependency.
- **Deterministic reproductions** where the bug does not need a real
  filesystem, network, or process scheduler.

## What does **not** route here

- Anything needing real OS processes, sockets, or devices → Layer 2.
- Anything whose repro depends on specific thread/scheduler interleavings
  or on GDB/rr-style time travel → Layer 3.
- Bugs that only manifest at GB+ data scales (WASM memory cap, browser
  tab practicality) → Layer 2.

## Candidate runtimes

| Language | Runtime                         | Status   |
|----------|---------------------------------|----------|
| Python   | [Pyodide](https://pyodide.org)  | Active |
| SQLite   | Pyodide `sqlite3`               | Active |
| Rust     | `wasm32-wasip1`                 | Active |
| Ruby     | [Ruby.wasm](https://github.com/ruby/ruby.wasm) | Active |
| PHP      | [php-wasm](https://github.com/WordPress/wordpress-playground) | Active |

Concrete runtime choices land in [`docs/site/`](../../docs/site/) as ADRs, not
here.

## Catalogue

Layer 1 recipes are immediate subdirectories such as
[`pandas-56679/`](./pandas-56679/), [`regex-779/`](./regex-779/), and
[`ruby-21709/`](./ruby-21709/). They are static browser pages published
under `/vivarium/repro/<project>/<issue_path>/` by the `deploy-docs`
workflow.

## Conventions

Each new Layer 1 recipe is its own immediate subdirectory of this folder
(e.g. `numpy-12345/`, `pandas-56679/`). The directory is required to
contain an `index.html`; companion files (`repro.ts`, `README.md`,
fixtures, generated-highlight inputs) live alongside.

## Page shape — two output panes

Every recipe page puts the reproduction script on the left and **two**
output panes on the right: **Baseline output**, the behaviour visitors
came to see, and **Fix-candidate output**, the same reproduction run
against a build where the bug is fixed. Seeing both at once is the
point of the page — a single pane only tells you something is wrong,
not what "right" looks like.

Not every bug has a fixed build that can run in a browser. When it
does not — the upstream issue is still open, or the fixed build cannot
be produced for WASM — the second pane says exactly that and names the
upstream status. It never shows a hand-written "expected" output:
Vivarium reproduces, it does not assert.

The markup is shared: it lives once in
[`_shared/page.template.html`](./_shared/page.template.html), and each
recipe supplies only its own slots in `page.en.html`.
[`scripts/validate-page-slots.ts`](./scripts/validate-page-slots.ts)
requires those slots at build time.

How the pane gets filled is not prescribed. Three shapes exist today:

| Shape | Mechanism | Recipes |
| ----- | --------- | ------- |
| Fork wheel | `fix-candidate.json` + [`_shared/fix-candidate.ts`](./_shared/fix-candidate.ts); CI builds the wheel and the page installs it | `dateutil-1478`, `lark-1585` |
| Second artefact | a sibling crate compiled from the same source against a fixed dependency version | `regex-779` |
| No runnable fix | a static note naming the upstream status | the rest |

## Verdict surface

Every Layer 1 reproduction emits its verdict via the in-page surface
defined by [Vivarium Contract v1](../../docs/site/en/spec/contract-v1.md)
— the `<meta name="vivarium-contract">` tag, the
`#verdict[data-verdict]` DOM element, and the
`__VIVARIUM_VERDICT__` / `__VIVARIUM_RESULT__` JavaScript globals.
The helper in [`_shared/verdict.ts`](./_shared/verdict.ts) keeps the
DOM and globals in sync; the Playwright suite at [`tests/repro.spec.ts`](./tests/repro.spec.ts)
asserts conformance on every PR. Layer 1 does not ship a
`verdict.json` — its verdict is live in-page.
