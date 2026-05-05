# Vivarium Contract v1

> The reproduction-verdict surface that every Vivarium-compatible
> reproduction page emits. Stable since Phase 1, locked at v1 by
> [ADR-0014](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0014-contract-v1-as-public-spec.md)
> (private memo). Currently at **revision 3** — see the
> [revision history](#revision-history) at the foot of this page.

## At a glance

A page conforming to Vivarium Contract v1 publishes:

- A constant version declaration:
  - `<meta name="vivarium-contract" content="v1">` in `<head>`.
  - `"contract": "v1"` in any JSON envelope it emits (in-page
    `__VIVARIUM_RESULT__` global, or the `verdict.json` file).
- A **verdict** — one of `"reproduced"` (the upstream bug was
  reproduced), `"unreproduced"` (it was not), or `"pending"` (run not
  yet finished).
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

`reproduced` means **the upstream bug was reproduced** in this run.
The page demonstrates the failure the upstream report describes; the
reproduction is doing its job.

`unreproduced` means the bug **did not reproduce**. Either the
runtime shipped a fix the page picked up (e.g., Pyodide upgraded its
bundled pandas past the buggy release), or the runtime regressed in
a different way before producing a verdict at all. Either reading is
worth investigating — the page is no longer demonstrating what its
README claims.

`pending` is the default state until the reproduction code (Layer 1)
or the verdict-snapshot fetch (Layer 2 / 3) settles.

> **Vocabulary note.** The verdict values were `"pass"` / `"fail"` in
> revisions 1 and 2 of this contract. The original wording carried a
> deliberate inversion of the typical CI "green = good" framing — a
> "pass" meant the bug *was* reproduced — which doubled as cognitive
> tax on every reader. Revision 3 ([ADR-0029](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0029-contract-v1-verdict-rename.md),
> private memo) renames the values to `"reproduced"` / `"unreproduced"`
> so that the literal name matches the meaning directly. The contract
> version literal (`v1`) is unchanged; this rename is a v1-internal
> breaking change absorbed under the pre-adoption carve-out in
> [`AGENTS.md` § 4.11](https://github.com/aletheia-works/vivarium/blob/main/AGENTS.md).

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
| `data-verdict` | `"pending"` \| `"reproduced"` \| `"unreproduced"` | machine-readable verdict |
| `class` | `"pending"` \| `"reproduced"` \| `"unreproduced"` (one of) | CSS hook |
| text content | human-readable verdict line | visitor-facing message |

The reproduction code transitions the element from `"pending"` to
`"reproduced"` or `"unreproduced"` exactly once per page load.

### JavaScript globals

```ts
globalThis.__VIVARIUM_VERDICT__: "pending" | "reproduced" | "unreproduced";
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

### DOM evidence element (optional, revision 2+)

```html
<div id="evidence" hidden>
  <pre data-evidence="stdout">…captured stdout…</pre>
  <pre data-evidence="stderr">…captured stderr…</pre>
  <span data-evidence="exit-code">0</span>
  <span data-evidence="duration-ms">123</span>
</div>
```

The `#evidence` container is **optional**. Pages predating revision 2
omit it; v1 consumers ignore the absence. When present, it carries
machine-readable run evidence used by tooling such as the
reproduction-comparison UI to render side-by-side panels.

| `[data-evidence]` value | content | typical source |
|---|---|---|
| `stdout` | captured standard output | Layer 1: assertion-related text the reproduction emits. Layer 2 / 3: lifted from `verdict.json#stdout`. |
| `stderr` | captured standard error (may be tail-truncated) | Layer 1: emitted by the reproduction. Layer 2 / 3: lifted from `verdict.json#stderr_tail` (renamed at the lift boundary; see [Verdict snapshot file](#verdict-snapshot-file-verdictjson) below). |
| `exit-code` | integer exit code, or empty | Layer 2 / 3: `verdict.json#exit_code`. Layer 1: omitted (browser-side has no process exit code). |
| `duration-ms` | wall-clock duration in milliseconds | mirrors `__VIVARIUM_RESULT__.timing.duration_ms`. |

A page MAY emit a subset of these children. Consumers MUST treat a
missing `[data-evidence="<key>"]` as `null` / absent, not as an
error. The `hidden` attribute keeps the surface invisible in
default rendering; presentation components style and reveal it.

The `stdout` / `stderr` text MAY be truncated to bound page size; by
convention, Layer 1 helpers cap each at 4 KiB to match the existing
Layer 2 / 3 `verdict.json#stderr_tail` truncation rule.

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

  // optional, revision 2+ — see "DOM evidence element" above
  evidence?: {
    stdout?: string;       // may be truncated to 4 KiB
    stderr?: string;       // may be truncated to 4 KiB
    exit_code?: number | null;  // null on Layer 1; integer on Layer 2 / 3
    // duration_ms is NOT duplicated here — see `timing.duration_ms`
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

`evidence` is optional and was added in revision 2. Consumers MUST
feature-detect it (`if (result.evidence) …`) — pages predating
revision 2 omit the field entirely. The `evidence.stdout` and
`evidence.stderr` strings on this envelope correspond to the DOM
`[data-evidence="stdout"]` / `[data-evidence="stderr"]` children
described above; tooling reading the structured envelope and tooling
reading the DOM see the same data through two paths.

## Verdict snapshot file (`verdict.json`)

For Layer 2 and Layer 3, the gallery page does not run the
reproduction live — it consumes a snapshot file that CI (Layer 2)
or the maintainer (Layer 3) wrote at the time of the last
reproduction attempt. The file is fetched on page load and lifted
into the in-page surface (`__VIVARIUM_RESULT__` etc.) by
[`src/layer2_docker/_layer2-shared/layer2.js`](https://github.com/aletheia-works/vivarium/blob/main/src/layer2_docker/_layer2-shared/layer2.js).

Schema: [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json) (JSON Schema
draft 2020-12).

Field summary:

| field | type | required | meaning |
|---|---|---|---|
| `contract` | `"v1"` (literal) | ✅ | version literal — always `"v1"` for this spec |
| `verdict` | `"reproduced"` \| `"unreproduced"` | ✅ | snapshot verdict (no `"pending"` — the snapshot is post-run) |
| `exit_code` | integer | ✅ | recorded program / replay exit code |
| `image_tag` | string | ✅ | docker image tag the snapshot was captured against |
| `image_digest` | string | ✅ | docker image identifier — CI-pushed captures use the registry RepoDigest, Layer 3 local-build captures use the local image ID (`docker inspect --format='{{.Id}}'`); empty string allowed when neither is available |
| `captured_at` | ISO-8601 string | ✅ | wall-clock timestamp of the snapshot |
| `stdout` | string | ✅ | full stdout, or page-specific JSON-encoded output |
| `stderr_tail` | string | ✅ | last 4 KiB of stderr, truncated front-back to fit |

The schema enforces the v1 invariant: `contract === "v1"` and
`verdict ∈ {"reproduced", "unreproduced"}`. Layer 1 does **not** ship
a `verdict.json`; its verdict is live in-page.

### Lift to the in-page evidence surface (revision 2+)

Layer 2 / Layer 3 pages do not duplicate the snapshot's evidence
fields into their own DOM at write time — the snapshot is the source.
The gallery loader lifts them into the [DOM evidence element](#dom-evidence-element-optional-revision-2)
on page load:

| `verdict.json` source | in-page surface |
|---|---|
| `stdout` | `evidence.stdout` envelope field + `[data-evidence="stdout"]` DOM child |
| `stderr_tail` | `evidence.stderr` envelope field + `[data-evidence="stderr"]` DOM child |
| `exit_code` | `evidence.exit_code` envelope field + `[data-evidence="exit-code"]` DOM child |

The `stderr_tail` → `evidence.stderr` rename keeps the in-page
contract surface uniform with Layer 1 (where the reproduction code
emits the text it wants captured directly, with no "tail" framing).
The 4 KiB front-back truncation rule is a property of the source
field; the in-page surface inherits whatever bound the source applied.

The schema is **not** amended for revision 2 — the source fields
were already present at the snapshot's top level since Phase 3
(see [ADR-0010](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0010-phase3-catalogue-model.md),
private memo).

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

The contract evolves under a two-tier policy:

- **Major bump (v2)** — required for changes to existing v1 fields
  (renamed, removed, type changed, semantics changed, optional →
  required). A v2 ships a new spec page, a new JSON Schema sibling,
  and a separate ADR; consumers will be expected to support v1 and
  v2 simultaneously by dispatching on the version literal.
- **Minor revision (within v1)** — used for **optional, additive**
  surface that v1 consumers can ignore. The version literal stays
  `"v1"` (no `meta` change, no `verdict.json#contract` change), the
  same spec page is updated, and the
  [revision history](#revision-history) below records the addition
  with date and ADR reference. Consumers feature-detect the new
  surface (e.g. `if (result.evidence) …`).

This sharpening of the policy was added with revision 2 (see
[ADR-0018](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0018-contract-v1-evidence-extension.md),
private memo).

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
   [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json).

CI enforces these clauses mechanically — currently via
[`src/layer1_wasm/tests/repro.spec.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/tests/repro.spec.ts)
(Playwright assertions on clauses 1–3) and the
`jq -e '.contract == "v1" and …'` predicates in
[`.github/workflows/repro-regression.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/repro-regression.yml)
(clause 4). The follow-up PR for [Issue #109](https://github.com/aletheia-works/vivarium/issues/109)
will replace clause 4's `jq` validators with an `ajv-cli` schema
validator pointed at the schema file above, keeping clause-4
enforcement single-sourced.

The optional revision-2 evidence surface deliberately has **no**
conformance clause: gating an optional surface on CI would create
the wrong incentive (page authors padding empty evidence elements
just to satisfy the gate). When the gallery's first non-PoC page emits evidence,
a follow-up Issue can decide whether to enforce shape (e.g. "if
`#evidence` exists, it must contain at least one
`[data-evidence]` child") at that point.

## Revision history

The version literal carried in `<meta name="vivarium-contract">` and
`verdict.json#contract` is `"v1"`; the revisions below are
non-breaking, additive evolutions of v1's surface. Pre-revision-2
pages stay conformant unchanged.

| Revision | Date | ADR | Change |
|---|---|---|---|
| 1 | Phase 1 (Layer 1 surface) → 2026-04-28 (locked) | [ADR-0008](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0008-phase1-gallery-structure.md) (private memo); locked at v1 by [ADR-0014](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0014-contract-v1-as-public-spec.md) (private memo) | Initial published surface: `<meta>`, `#verdict[data-verdict]`, JS globals, `VivariumResultV1` envelope, Layer 2/3 `verdict.json` snapshot. |
| 2 | 2026-04-30 | [ADR-0018](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0018-contract-v1-evidence-extension.md) (private memo) | Optional `#evidence` DOM container with `[data-evidence]` children (`stdout`, `stderr`, `exit-code`, `duration-ms`) and matching `__VIVARIUM_RESULT__.evidence` envelope field. Layer 2/3 lift renames `verdict.json#stderr_tail` → `evidence.stderr` at the lift boundary; `verdict.schema.json` is unchanged. Minor-revision policy in [Versioning](#versioning) above is also clarified by this ADR. |
| 3 | 2026-05-05 | [ADR-0029](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0029-contract-v1-verdict-rename.md) (private memo) | **Breaking within v1.** Verdict enum values renamed: `"pass"` → `"reproduced"`, `"fail"` → `"unreproduced"` (`"pending"` unchanged). The contract version literal stays `v1`. `verdict.schema.json` enum is updated; old snapshots that still carry `"pass"` / `"fail"` no longer validate. CSS class names on `#verdict` and the `data-verdict` attribute follow the same rename. Absorbed in-place rather than bumped to `v2` per the pre-adoption breaking-change carve-out in [`AGENTS.md` § 4.11](https://github.com/aletheia-works/vivarium/blob/main/AGENTS.md). |

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
- ADR-0018 — revision 2 evidence surface and minor-revision policy
  (private memo).
