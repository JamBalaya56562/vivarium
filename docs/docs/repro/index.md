# Reproductions

Each card below is a real bug from a real upstream project, reproduced
in your browser via a WebAssembly language runtime. Click "Open" to
load the page; the verdict appears at the top once the runtime
finishes loading and the reproduction script has run.

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

## Layer 1 — Pyodide (Python)

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

## Layer 1 — Ruby.wasm (Ruby)

| Project | Issue | Verdict | |
| --- | --- | --- | --- |
| ruby | [#21709](https://bugs.ruby-lang.org/issues/21709) — Regexp interpolation rejects mixed encodings while String interpolation silently upgrades to UTF-8 | `pass` (bug reproduces) | [Open ↗](https://aletheia-works.github.io/vivarium/repro/ruby-21709/) |

The Verdict column reflects what the page reports on
`@ruby/3.3-wasm-wasi` (Ruby 3.3.3 over WASI) at the time of writing.
The upstream issue is currently Open with a draft patch in flight;
when a fix lands and is picked up by Ruby.wasm the verdict will flip
to `fail`.

## Layer 1 — php-wasm (PHP)

| Project | Issue | Verdict | |
| --- | --- | --- | --- |
| php | [#12167](https://github.com/php/php-src/issues/12167) — `SimpleXMLElement::xpath('//processing-instruction()')` finds the PI node, but casting it to string yields an empty value | `pass` (bug reproduces) | [Open ↗](https://aletheia-works.github.io/vivarium/repro/php-12167/) |

The Verdict column reflects what the page reports on `php-wasm@0.0.8`
(PHP 8.2.11, Linux, 32-bit, Zend 4.2.11) at the time of writing. The
bug was fixed upstream in PHP 8.2.12, so when php-wasm bumps to a
build that ships ≥ 8.2.12 the verdict will flip to `fail` and the
page becomes a fix-detection signal.

## Layer 1 — Rust (wasm32-wasip1 via WASI shim)

| Project | Issue | Verdict | |
| --- | --- | --- | --- |
| regex | [#779](https://github.com/rust-lang/regex/issues/779) — `(re)+` and `(re)(re)*` produce different match-iteration outputs | `pass` (bug reproduces) | [Open ↗](https://aletheia-works.github.io/vivarium/repro/regex-779/) |

The Verdict column reflects what the page reports against
`regex = "=1.8.4"` compiled to `wasm32-wasip1` and instantiated
in-browser via [`@bjorn3/browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim).
Unlike Pyodide / Ruby.wasm / php-wasm, Rust ships **no** single
CDN-hosted runtime; the deploy workflow runs `cargo build --release
--target wasm32-wasip1` once per page and serves the resulting
`.wasm` next to `index.html`. The fix for #779 landed in regex 1.9
together with the new NFA compiler, so this page intentionally pins
to the last 1.8.x line; bumping past 1.9 will flip the verdict to
`fail`, turning the page into a fix-detection sentinel.

## Native re-verification

Each gallery page has a companion CLI variant — `repro.py`,
`repro.rb`, or `repro.php` — that runs the *same* logic against a
real native interpreter, with no WASM layer involved. The
`.mise.toml` at the repo root pins each interpreter to the same
major.minor.patch the WASM runtime bundles, so:

```bash
mise install                                                    # one-time per machine
mise exec ruby -- ruby src/layer1_wasm/ruby-21709/repro.rb
mise exec php  -- php  src/layer1_wasm/php-12167/repro.php
mise exec rust -- cargo run --release --manifest-path src/layer1_wasm/regex-779/Cargo.toml
```

`mise install` requires a Unix-y toolchain to build PHP / Ruby from
source — Linux and macOS work directly, on Windows use WSL or an
equivalent layer.

## Adding a reproduction

A new reproduction page lives under
[`src/layer1_wasm/<project>-<issue>/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm)
and ships:

- `index.html` declaring the contract version, with a `#verdict` band
  and `<script src="./repro.js">`.
- `repro.ts` that imports the runtime loader (`loadVivariumPyodide`
  for Python via Pyodide, `loadVivariumRuby` for Ruby via Ruby.wasm,
  `loadVivariumPhp` for PHP via php-wasm, `loadVivariumRust` for a
  `wasm32-wasip1` Rust artefact via the WASI shim) plus `setVerdict`
  and `setResult` from
  [`../_shared/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm/_shared)
  and publishes a `VivariumResultV1` envelope on completion.
- A short `README.md` explaining the bug and the verdict criterion.
- A native CLI variant (`repro.py` / `repro.rb` / `repro.php`, or for
  Rust the same `Cargo.toml` + `src/main.rs` runs via `cargo run`)
  with identical reproduction logic, for re-verification against a
  real interpreter / compiler via `mise exec`.

The deploy workflow handles bundling and the `.ts` → `.js` build —
contributors only edit TypeScript sources.
