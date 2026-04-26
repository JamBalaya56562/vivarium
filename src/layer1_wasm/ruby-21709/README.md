# Reproduction — ruby/ruby#21709

> Phase 2 reproduction page — first non-Pyodide entry in Vivarium's
> gallery. Conforms to `vivarium-contract: v1`.

## The bug

[ruby/ruby#21709](https://bugs.ruby-lang.org/issues/21709) — Regexp
interpolation rejects fragments of differing encodings, while String
interpolation silently upgrades them to UTF-8:

```ruby
prefix = '\p{In_Arabic}'
suffix = '\p{In_Arabic}'.encode('US-ASCII')

/#{prefix}#{suffix}/   # => RegexpError: encoding mismatch in dynamic regexp
"#{prefix}#{suffix}"   # => "\p{In_Arabic}\p{In_Arabic}" (UTF-8)
```

The two interpolation forms should agree on how to combine fragments
of different encodings. The disagreement is the bug surface.

## Why this bug

- Pure Ruby standard library (Regexp, String, Encoding) — no gems,
  no native extensions, no I/O.
- Verdict reduces to a boolean — Regexp build raises ∧ String build
  succeeds — so the page emits a mechanically-distinguishable `pass`
  / `fail`.
- Open upstream (Status: Open) at the time of writing; reported
  against Ruby 3.4 and confirmed to affect 3.2 / 3.3 / 3.4. A draft
  patch is in flight but has not landed.
- Suits the WASM cell shape exactly — Ruby.wasm bundles full Onigmo
  and Encoding support, so this reproduces without runtime gaps.
- Demonstrates that Vivarium's Layer 1 gallery is not Pyodide-only:
  Ruby.wasm is the second WASM runtime in the gallery and the first
  page that uses it.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumRuby` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |

Shared visual presentation lives in [`../_shared/style.css`](../_shared/style.css).
The Ruby.wasm loader lives in [`../_shared/ruby_loader.ts`](../_shared/ruby_loader.ts).

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The `result` field
of the envelope reports `regexp_built`, `regexp_raised`,
`string_built`, `string_encoding`, `string_raised`, and
`reproduced` — enough for downstream tooling to distinguish the
specific shape of any future change.

A `pass` means **the bug reproduced** — Regexp interpolation raised
while String interpolation succeeded. A `fail` means either the
runtime ships a fix (both forms succeed, or both raise the same
way), or the runtime errored before producing a result.

## Running locally

```bash
cd src/layer1_wasm
bun install
bun run build
python -m http.server -d . 8767
# open http://localhost:8767/ruby-21709/
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/ruby-21709/` by the
`deploy-docs` workflow.
