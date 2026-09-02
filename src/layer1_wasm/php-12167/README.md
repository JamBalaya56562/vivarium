# Reproduction — php/php-src#12167

> Phase 2 reproduction page — second non-Pyodide entry in Vivarium's
> gallery (after [`ruby-21709/`](../ruby-21709/)). Conforms to
> `vivarium-contract: v1`.

## The bug

[php/php-src#12167](https://github.com/php/php-src/issues/12167) —
PHP's `SimpleXMLElement::xpath('//processing-instruction()')` finds
the processing-instruction node correctly, but casting that node to
a string yields an empty value instead of the PI's content:

```php
<?php
$xml = '<?xml version="1.0"?><foo><bar><?stylesheet hello ?></bar></foo>';
$sxe = simplexml_load_string($xml);
$pi  = $sxe->xpath("//processing-instruction()")[0];

echo (string) $pi;   // BUG: ""        (expected "hello")
```

xpath returns the node — `count($pis) === 1` — so the bug is purely
in the SimpleXML string-cast path for processing-instruction nodes.
Fixed upstream in PHP 8.2.12; `php-wasm@0.0.8` ships PHP 8.2.11, so
the page reproduces.

## Why this bug

- PHP standard library only — SimpleXML is a core extension shipped
  by every mainstream PHP build (and bundled into php-wasm).
- Verdict reduces to a boolean — `count($pis) === 1` ∧ `(string)
  $pis[0] === ""` — so the page emits a mechanically-distinguishable
  `reproduced` / `unreproduced`.
- Closed upstream by [PR #12190](https://github.com/php/php-src/pull/12190),
  merged into `PHP-8.2.12`.
- Reproduces without I/O, network, or non-default extensions — fits
  the WASM cell shape exactly.

## Why the fix-candidate pane is empty

The fix exists upstream, but no published php-wasm build can run this
reproduction against it, so the page's second pane says so rather than
showing a result.

`php-wasm@0.0.8` — the version [`_shared/php_loader.ts`](../_shared/php_loader.ts)
pins — ships PHP 8.2.11 and reproduces the bug (`count=1`, cast `""`).
The only newer stable release, `php-wasm@0.1.0`, ships PHP 8.4.1 but
its `PhpWeb.mjs` build has **no SimpleXML**: `simplexml_load_string()`
is undefined, so the reproduction cannot run at all, let alone show the
fix. The single prerelease between them, `0.0.9-alpha-32`, never
finished initialising when tried (no `ready` event after several
minutes).

This also corrects an earlier note in this file, which described the
recipe as a "sentinel" that would flip to `unreproduced` once php-wasm
bumped past 8.2.12. Bumping the pin does not flip the verdict — it
breaks the reproduction. Restoring the second pane needs a php-wasm
build that is both ≥ 8.2.12 **and** compiled with SimpleXML.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumPhp` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.php`  | **Native CLI variant.** Same reproduction logic, runnable directly under a real PHP interpreter. See "Native verification" below. |

Shared visual presentation lives in
[`../_shared/style.css`](../_shared/style.css). The php-wasm loader
lives in [`../_shared/php_loader.ts`](../_shared/php_loader.ts).

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The `result` field
of the envelope reports `xpath_count`, `pi_text`, `pi_text_empty`,
and `reproduced` — enough for downstream tooling to distinguish the
specific shape of any future change.

A `reproduced` verdict means **the bug reproduced** — xpath
returned the PI node *and* its string-cast was empty. An
`unreproduced` verdict means either the runtime ships a fix (PI
string-cast now non-empty), or the runtime errored before producing
a result.

## Running locally — in-browser

```bash
cd src/layer1_wasm
bun install
bun run build
python -m http.server -d . 8767
# open http://localhost:8767/php-12167/
```

## Native verification — same reproduction under a real PHP

The companion `repro.php` script reproduces the bug without any
WASM layer, so a contributor can confirm the gallery page is
catching a *real* upstream behaviour rather than a php-wasm
quirk. The `mise.toml` at the repo root pins PHP to **8.2.11**
to match the version php-wasm bundles, so:

```bash
# One-time per machine / mise.toml change.
mise install

# Reproduces the bug; exits 0 on `reproduced`.
mise exec php -- php src/layer1_wasm/php-12167/repro.php

# Expected output (8.2.11):
# {
#     "php_version": "8.2.11",
#     "xpath_count": 1,
#     "pi_text": "",
#     "pi_text_empty": true
# }
# verdict=reproduced — bug reproduces on this interpreter
```

`mise install` may need a Unix-y toolchain (autoconf, libxml2
headers, etc.) to build PHP from source — Linux and macOS work out
of the box; on Windows use WSL or an equivalent layer. CI installs
mise on a Linux runner.

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/php/12167/` by the
`deploy-docs` workflow.
