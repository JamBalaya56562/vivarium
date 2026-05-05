# External examples (manifest v1 reference)

> **Purpose:** demonstrate how a repository *outside*
> `aletheia-works/vivarium` would declare a Vivarium-runnable
> reproduction via the
> [Manifest v1 spec](../../docs/docs/spec/manifest-v1.md).
>
> Each subdirectory here is treated as if it were a separate
> external repo's root. The `.vivarium/manifest.toml` inside
> shows what that repo would commit; the rest of the repo
> (Dockerfile, source, etc.) is **not** duplicated — these
> manifests point at vivarium's own publicly-deployed pages and
> GHCR images so they are runnable as written rather than just
> shape-valid.

---

## What this directory is

A reference / smoke-test for the manifest spec. Three example
manifests, one per layer:

| Subdirectory | Layer | Points at |
|---|---|---|
| [`layer1-pandas-56679/`](./layer1-pandas-56679/.vivarium/manifest.toml) | 1 (WASM) | `https://aletheia-works.github.io/vivarium/repro/pandas/56679/` |
| [`layer2-bash-local-shadows-exit/`](./layer2-bash-local-shadows-exit/.vivarium/manifest.toml) | 2 (Docker) | `ghcr.io/aletheia-works/vivarium-bash-local-shadows-exit:latest` |
| [`layer3-lost-update/`](./layer3-lost-update/.vivarium/manifest.toml) | 3 (record-replay) | `ghcr.io/aletheia-works/vivarium-lost-update:latest` |

CI (`repro-regression.yml`) validates every
`src/external_examples/*/.vivarium/manifest.toml` against
[`docs/public/spec/manifest.schema.json`](../../docs/public/spec/manifest.schema.json)
on every push and pull request. A schema mismatch fails the
workflow loudly.

## What this directory is **not**

- **Not a reproduction catalogue.** Layer 1 / 2 / 3 reproductions
  authored by `aletheia-works/vivarium` itself live under
  [`src/layer1_wasm/`](../layer1_wasm/),
  [`src/layer2_docker/`](../layer2_docker/), and
  [`src/layer3_thirdway/`](../layer3_thirdway/). The examples here
  *describe* those same recipes from a hypothetical external
  repo's perspective; they do not duplicate the recipe sources.
- **Not a substitute for `aletheia-works/vivarium`'s catalogue.**
  Vivarium consumes its own per-layer catalogues directly. The
  manifest format exists so an *external* project — one that is
  not this repo — can advertise a Vivarium-compatible reproduction
  without requiring Vivarium to know about it ahead of time.

## Adding a new example

1. Create `src/external_examples/<your-example-slug>/.vivarium/manifest.toml`.
2. Set `manifest = "v1"`, fill in `slug`, `title`, `layer`,
   `[bug]`, and the layer-specific table per the
   [spec](../../docs/docs/spec/manifest-v1.md).
3. Open a PR. CI validates the new manifest against the schema.

The `<your-example-slug>` directory name does not need to match
the manifest's `slug` field — they are conceptually separate
(directory name = "this example", manifest slug = "the
reproduction the example describes"). In practice keeping them
similar is helpful.

## Phase context

Phase 5 sub-stream C per
[ADR-0013](../../_context/decisions/0013-phase5-opener.md)
(private memo). Manifest format locked at v1 by
[ADR-0015](../../_context/decisions/0015-third-party-manifest-format.md)
(private memo).
