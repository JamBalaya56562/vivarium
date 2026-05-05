# Vivarium recipes index (v1)

> Machine-generated catalogue index of every reproduction this repository hosts.
> Locked at v1 by [ADR-0019](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0019-vivarium-mcp-server-design.md)
> (private memo). Consumed by the
> [Vivarium MCP server](https://github.com/aletheia-works/vivarium/tree/main/packages/mcp-server)
> and any other programmatic tool that wants to list, filter, or look up
> recipes.

## At a glance

URL: <https://aletheia-works.github.io/vivarium/api/recipes.json>

```json
{
  "index": "v1",
  "contract": "v1",
  "recipes": [
    {
      "slug": "pandas-56679",
      "layer": 1,
      "project": "pandas",
      "issue": 56679,
      "title": "pandas-dev/pandas#56679",
      "page_url": "https://aletheia-works.github.io/vivarium/repro/pandas/56679/",
      "source_url": "https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm/pandas-56679"
    },
    {
      "slug": "bash-local-shadows-exit",
      "layer": 2,
      "project": "bash",
      "issue": 0,
      "title": "bash `local` shadows command-substitution exit code",
      "page_url": "https://aletheia-works.github.io/vivarium/repro/bash/local-shadows-exit/",
      "verdict_url": "https://aletheia-works.github.io/vivarium/repro/bash/local-shadows-exit/verdict.json",
      "source_url": "https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker/bash-local-shadows-exit"
    }
  ]
}
```

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `index` | `"v1"` literal | ✅ | Format version. New optional fields ship as same-page revisions; breaking changes are v2. |
| `contract` | `"v1"` literal | ✅ | The [Contract v1](./contract-v1.md) version that recipes' pages publish. |
| `recipes` | array of [recipe entries](#recipe-entry-fields) | ✅ | Every reproduction this repository hosts, sorted by layer then by slug. |

## Recipe entry fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string (kebab-case) | ✅ | Recipe directory name under `src/layer{N}_*/`. Same convention as Manifest v1's `slug`. |
| `layer` | integer (`1` \| `2` \| `3`) | ✅ | Layer 1 = WASM in browser; Layer 2 = Docker; Layer 3 = record-replay. |
| `project` | string | ✅ | Upstream project name (e.g. `"pandas"`, `"bash"`). |
| `issue` | integer | ✅ | Upstream issue number; `0` if no upstream tracker entry. |
| `title` | string | ✅ | Human-readable title, from the recipe README's first H1. |
| `page_url` | URI | ✅ | Live reproduction page (Layer 1: WASM page; Layer 2 / 3: docker-run instructions page). |
| `verdict_url` | URI | ⏳ | Layer 2 / 3 only — deployed `verdict.json` snapshot. Layer 1 verdicts are produced live in-page and have no static snapshot. |
| `source_url` | URI | ✅ | GitHub link to the recipe directory. |
| `language` | string | ⏳ | Optional. Primary implementation language, lowercase (e.g. `"python"`, `"rust"`, `"shell"`). Sourced from the [`docs/data/recipe-facets.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/data/recipe-facets.json) overlay (per ADR-0024). Added in the 2026-05-03 revision. |
| `symptom` | string (kebab-case) | ⏳ | Optional. Short symptom slug used by the error → recipe matcher (e.g. `"dtype-mismatch"`, `"ordering-non-transitive"`). Sourced from the facet overlay. Added 2026-05-03. |
| `severity` | string | ⏳ | Optional. Free-form severity bucket (e.g. `"bug"`, `"regression"`, `"spec-violation"`, `"footgun"`). Sourced from the facet overlay. Added 2026-05-03. |
| `tags` | array of strings | ⏳ | Optional. Free-form tag list scored by the matcher (e.g. `["sqlite3", "pragma", "foreign-keys"]`). Sourced from the facet overlay. Added 2026-05-03. |

## Versioning

The version is carried as `index = "v1"` on the top-level object. Per
[ADR-0018](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0018-contract-v1-evidence-extension.md)
(private memo)'s minor-revision policy:

- **Optional additive fields** ship as same-`v1` revisions; consumers
  feature-detect them. Phase 6 stream S.1 added `language`, `symptom`,
  `severity`, and `tags` under this rule (see revision history below).
- **Breaking changes** (renamed fields, type changes, optional → required)
  require a v2 schema sibling and a separate ADR.

There is no current v2.

## Revision history

| Date | Change | Reference |
|---|---|---|
| 2026-05-03 | Added optional `language`, `symptom`, `severity`, `tags` fields to recipe entries. Sourced from a centralised facet overlay (`docs/data/recipe-facets.json`), not per-recipe frontmatter. Backwards-compatible — v1 consumers ignore. | [ADR-0024](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0024-phase6-s1-faceted-gallery.md) (private memo) |

## Generation

The index is built by
[`docs/scripts/generate-recipes-index.ts`](https://github.com/aletheia-works/vivarium/blob/main/docs/scripts/generate-recipes-index.ts),
wired into the rspress `dev` and `build` scripts in
`docs/package.json`. The script walks the recipe directories, parses each
recipe README's first H1 for the title, and derives `project` / `issue`
from the slug pattern (`<project>-<digits>` for slugs with a trailing
issue number; first dash-segment otherwise, with a small override map for
recipes whose slug shape diverges).

The output is tracked in git so PRs that add a recipe also show the index
update in the diff. The optional facet fields (`language`, `symptom`,
`severity`, `tags`) are merged in from
[`docs/data/recipe-facets.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/data/recipe-facets.json),
a centralised overlay maintained by hand and reviewed in PR diff. The
`project` field stays slug-derived in v1 — Phase 6 stream S.1 (per
ADR-0024) deliberately rejected per-recipe frontmatter in favour of
the centralised overlay, since the recipe count fits comfortably in a
single reviewable file at this scale.

## Conformance

A `recipes.json` document conforms to v1 when:

1. It validates against
   [`recipes.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/api/recipes.schema.json).
2. `index === "v1"` and `contract === "v1"`.
3. Every entry's `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
4. Every Layer 2 / 3 entry includes `verdict_url`; Layer 1 entries omit it.

Clauses 1–3 are mechanically enforceable via schema validation. Clause 4
is a derivation-rule constraint not encoded in the schema's `oneOf` (kept
deliberately permissive: the MCP server treats a missing `verdict_url` on
a Layer 2 / 3 entry the same as `verdict_url` pointing at a 404 — both
are surfaced to the consumer as "no snapshot available").

## See also

- [Contract v1](./contract-v1.md) — the runtime verdict surface each
  recipe page publishes.
- [Manifest v1](./manifest-v1.md) — the upstream-side manifest format an
  external repo ships at `.vivarium/manifest.toml`. Recipe entries in
  this index correspond to internal recipes; external repos publish their
  own per-repo manifest instead of being listed here.
- ADR-0019 — load-bearing decision for this index and the Vivarium MCP
  server that consumes it (private memo).
- ADR-0018 — minor-revision policy this index reuses (private memo).
