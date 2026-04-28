# Vivarium Contract v1

> The reproduction-verdict surface that every Vivarium-compatible
> reproduction page emits. Stable since Phase 1, locked at v1 by
> [ADR-0014](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0014-contract-v1-as-public-spec.md)
> (private memo).

## At a glance

A page conforming to Vivarium Contract v1 publishes:

- A constant version declaration:
  - `<meta name="vivarium-contract" content="v1">` in `<head>`.
  - `"contract": "v1"` in any JSON envelope it emits (in-page
    `__VIVARIUM_RESULT__` global, or the `verdict.json` file).
- A **verdict** — one of `"pass"` (the upstream bug reproduces),
  `"fail"` (it does not), or `"pending"` (run not yet finished).
- A **result envelope** describing the bug, the runtime, and the
  page-specific output.

How those are exposed depends on the layer:

| Layer | Live in-page surface | File snapshot |
|---|---|---|
| **Layer 1** (WASM) | DOM + JS globals, set by the page's reproduction code as it runs | n/a — verdict is live |
| **Layer 2** (Docker) | DOM + JS globals, lifted from `verdict.json` at page load | `verdict.json` shipped alongside the recipe |
| **Layer 3** (record-replay) | DOM + JS globals, lifted from `verdict.json` at page load | `verdict.json` committed by the maintainer |

The DOM/global surface is therefore the same across all three
layers; the file snapshot only exists for Layer 2 and Layer 3.

## Verdict semantics

`pass` means **the upstream bug reproduces** in this run. The page
demonstrates the failure the upstream report describes; the
reproduction is doing its job.

`fail` means the bug **does not reproduce**. Either the runtime
shipped a fix the page picked up (e.g., Pyodide upgraded its bundled
pandas past the buggy release), or the runtime regressed in a
different way before producing a verdict at all. Either reading is
worth investigating — the page is no longer demonstrating what its
README claims.

`pending` is the default state until the reproduction code (Layer 1)
or the verdict-snapshot fetch (Layer 2 / 3) settles.

This convention is deliberately the **inverse** of typical CI
"green = good" framing. A passing reproduction is the demonstration
that the reported bug exists; a failing reproduction is a signal
that something changed, not a goal in itself.

## In-page surface (all layers)

### HTML meta tag

```html
<meta name="vivarium-contract" content="v1">
```

Required in `<head>` of every reproduction page.

### DOM verdict element

```html
<div id="verdict" data-verdict="pending" class="pending">
  Reproduction pending — loading runtime…
</div>
```

The element with `id="verdict"` carries:

| attribute / content | value | purpose |
|---|---|---|
| `data-verdict` | `"pending"` \| `"pass"` \| `"fail"` | machine-readable verdict |
| `class` | `"pending"` \| `"pass"` \| `"fail"` (one of) | CSS hook |
| text content | human-readable verdict line | visitor-facing message |

The reproduction code transitions the element from `"pending"` to
`"pass"` or `"fail"` exactly once per page load.

### JavaScript globals

```ts
globalThis.__VIVARIUM_VERDICT__: "pending" | "pass" | "fail";
globalThis.__VIVARIUM_RESULT__: VivariumResultV1;  // see envelope below
```

`__VIVARIUM_VERDICT__` mirrors `#verdict[data-verdict]` — they are
written together by the helper in
[`src/layer1_wasm/_shared/verdict.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/_shared/verdict.ts).
A divergence between them indicates a broken page; tests cross-check
both.

`__VIVARIUM_RESULT__` is the structured envelope (next section). It
is set when the page produces (Layer 1) or fetches (Layer 2 / 3) its
verdict.

## Result envelope (`VivariumResultV1`)

Type, expressed in TypeScript:

```ts
interface VivariumResultV1 {
  contract: "v1";
  bug: {
    project: string;       // e.g. "pandas"
    issue: number;         // e.g. 56679 — no `#` prefix
    upstream_url: string;  // URL to the upstream issue or PR
  };
  runtime: {
    name: string;          // see runtime.name table below
    version: string;       // e.g. "0.29.3"
    extras: Record<string, string>;  // free-form (python/pandas versions etc.)
  };
  result: Record<string, unknown>;   // page-specific structured output
  timing: {
    started_at: string;    // ISO-8601
    finished_at: string;   // ISO-8601
    duration_ms: number;   // wall-clock, milliseconds
  };
}
```

`runtime.name` is free-form, but the values currently in use across
the gallery are:

| value | meaning |
|---|---|
| `"browser"` | smoke test, no WASM runtime loaded |
| `"pyodide"` | Python over WebAssembly |
| `"ruby.wasm"` | Ruby over WebAssembly |
| `"php-wasm"` | PHP over WebAssembly |
| `"rust-wasi"` | Rust compiled to `wasm32-wasip1` |
| `"docker-snapshot"` | Layer 2 / Layer 3 page rendering a CI- or maintainer-captured `verdict.json` |

External reproductions are free to add new values; downstream
tooling treats `runtime.name` as opaque.

`result` is intentionally `Record<string, unknown>` — its shape is
per-page (e.g. pandas reproduction may put `{ wrong_value, expected_value }`,
a regex reproduction may put `{ matched, expected_match }`). Pages
document their own `result` shape in their README; the contract only
guarantees the field exists.

## Verdict snapshot file (`verdict.json`)

For Layer 2 and Layer 3, the gallery page does not run the
reproduction live — it consumes a snapshot file that CI (Layer 2)
or the maintainer (Layer 3) wrote at the time of the last
reproduction attempt. The file is fetched on page load and lifted
into the in-page surface (`__VIVARIUM_RESULT__` etc.) by
[`src/layer2_docker/_layer2-shared/layer2.js`](https://github.com/aletheia-works/vivarium/blob/main/src/layer2_docker/_layer2-shared/layer2.js).

Schema: [`verdict.schema.json`](https://aletheia-works.github.io/vivarium/spec/verdict.schema.json) (JSON Schema
draft 2020-12).

Field summary:

| field | type | required | meaning |
|---|---|---|---|
| `contract` | `"v1"` (literal) | ✅ | version literal — always `"v1"` for this spec |
| `verdict` | `"pass"` \| `"fail"` | ✅ | snapshot verdict (no `"pending"` — the snapshot is post-run) |
| `exit_code` | integer | ✅ | recorded program / replay exit code |
| `image_tag` | string | ✅ | docker image tag the snapshot was captured against |
| `image_digest` | string | ✅ | docker image identifier — CI-pushed captures use the registry RepoDigest, Layer 3 local-build captures use the local image ID (`docker inspect --format='{{.Id}}'`); empty string allowed when neither is available |
| `captured_at` | ISO-8601 string | ✅ | wall-clock timestamp of the snapshot |
| `stdout` | string | ✅ | full stdout, or page-specific JSON-encoded output |
| `stderr_tail` | string | ✅ | last 4 KiB of stderr, truncated front-back to fit |

The schema enforces the v1 invariant: `contract === "v1"` and
`verdict ∈ {"pass", "fail"}`. Layer 1 does **not** ship a
`verdict.json`; its verdict is live in-page.

### Why no `"pending"` in the file

The snapshot is written *after* the recorded program / replay
finishes. There is no captured `"pending"` snapshot — by the time
CI or the maintainer is writing the file, the run has already
settled. A `"pending"` value would mean a writer bug.

## Versioning

The version is carried in two places:

- `<meta name="vivarium-contract" content="v1">` — in-page.
- `verdict.json#contract` — file snapshot.

Both must agree on every page that ships both. A page declaring
`v1` MUST conform to this specification.

New fields, removed fields, or changed semantics require a v2
specification page, a v2 JSON Schema sibling, and a separate ADR;
consumers should be free to support v1 and v2 simultaneously by
dispatching on the version literal.

There is no current v2.

## Conformance

A reproduction page conforms to Vivarium Contract v1 when:

1. It includes `<meta name="vivarium-contract" content="v1">` in
   `<head>`.
2. It exposes the verdict via `#verdict[data-verdict]` and
   `__VIVARIUM_VERDICT__` together (matching values).
3. It exposes the structured envelope via `__VIVARIUM_RESULT__`,
   conforming to the `VivariumResultV1` type.
4. If it ships a `verdict.json`, the file validates against
   [`verdict.schema.json`](https://aletheia-works.github.io/vivarium/spec/verdict.schema.json).

CI enforces these clauses mechanically — currently via
[`src/layer1_wasm/tests/repro.spec.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/tests/repro.spec.ts)
(Playwright assertions on clauses 1–3) and the
`jq -e '.contract == "v1" and …'` predicates in
[`.github/workflows/repro-regression.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/repro-regression.yml)
(clause 4). The follow-up PR for [Issue #109](https://github.com/aletheia-works/vivarium/issues/109)
will replace clause 4's `jq` validators with an `ajv-cli` schema
validator pointed at the schema file above, keeping clause-4
enforcement single-sourced.

## References

- [`src/layer1_wasm/_shared/verdict.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/_shared/verdict.ts)
  — TypeScript helpers for the in-page surface.
- [`src/layer1_wasm/tests/repro.spec.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/tests/repro.spec.ts)
  — Playwright assertions on the surface.
- [`src/layer2_docker/_layer2-shared/layer2.js`](https://github.com/aletheia-works/vivarium/blob/main/src/layer2_docker/_layer2-shared/layer2.js)
  — gallery-side `verdict.json` → in-page surface lift.
- [`.github/workflows/repro-regression.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/repro-regression.yml)
  — current `jq -e` validators (target for replacement in PR 2).
- [`.github/workflows/deploy-docs.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/deploy-docs.yml)
  — Layer 2 build/run/snapshot workflow.
- ADR-0008 — Phase 1 gallery structure (original surface
  definition; private memo).
- ADR-0014 — this contract's stabilising decision (private memo).
