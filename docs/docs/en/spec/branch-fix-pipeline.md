# Branch-fix verdict pipeline

> A `workflow_dispatch` GitHub Actions workflow that captures a
> [Contract v1](./contract-v1.md) verdict for a contributor-supplied
> branch-fix Docker image, alongside the deployed original verdict,
> for side-by-side comparison.

The workflow lives at
[`.github/workflows/branch-fix-verdict.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/branch-fix-verdict.yml).
It is the **build & verify** half of Phase 6 sub-stream R
(reproduction comparison). The comparison-page UI half (R.3) is a
separate deliverable that consumes the artefact this pipeline
produces.

## Why this exists

Vivarium recipes pin one specific runtime (image, package version,
toolchain) so the gallery's verdict snapshot is stable. When a
contributor — human or AI agent — produces a candidate fix for the
upstream bug, they need a way to ask **"does my fix actually stop
the recipe from reproducing?"** before opening a PR.

The mechanical answer is: re-run the recipe against an image that
contains the fix, capture a fresh `verdict.json`, and compare it to
the original. If the original verdict was `"pass"` (bug reproduces)
and the branch-fix verdict is `"fail"` (bug does not reproduce), the
fix is doing its job.

This pipeline runs that comparison in CI. The contributor builds and
publishes the branch-fix image themselves; this workflow is purely a
verification surface.

## Five-line invocation

```bash
gh workflow run branch-fix-verdict.yml \
  --repo aletheia-works/vivarium \
  -f slug=bash-local-shadows-exit \
  -f branch_image=ghcr.io/contributor/bash-fix:branch-x \
  -f expected_verdict=fail
```

The run page renders a Markdown comparison summary, and the captured
verdicts are uploaded as a workflow artefact named
`branch-fix-verdict-<slug>-<run_id>` for download or programmatic
fetch.

## Inputs

| Input | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `slug` | string | ✅ | — | Recipe slug under [`src/layer2_docker/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker), e.g. `bash-local-shadows-exit`. The slug must exist in tree on the workflow's checkout; the workflow fails fast on a typo. |
| `branch_image` | string | ✅ | — | Docker image ref to verify (e.g. `ghcr.io/contributor/foo-fix:branch-x`). Must be pullable by the runner without authentication. Private-registry support is a follow-up. |
| `expected_verdict` | choice (`pass`\|`fail`) | — | `fail` | Verdict the contributor expects on the branch-fix image. `fail` (bug does NOT reproduce) is the typical "fix works" answer. The workflow's final step asserts the captured verdict matches this and exits non-zero on divergence. |
| `original_image` | string | — | (empty) | Optional override. By default the workflow fetches the deployed original verdict from GitHub Pages — cheaper than re-running an image and identical to what the gallery serves. Supplying an `original_image` re-captures from that image instead, useful for anchoring the comparison at a specific tag or testing a private fork. |

## Verdict semantics (reminder)

`pass` means **the upstream bug reproduces** in this run. `fail`
means it **does not**. This is the inverse of typical "green CI =
good" framing; see
[Contract v1: Verdict semantics](./contract-v1.md#verdict-semantics)
for the full reasoning.

For a recipe whose original verdict is `pass`, a successful
branch-fix is therefore expected to flip the verdict to `fail`. For
a recipe whose original verdict is already `fail` (a sentinel page
tracking an upstream-fix-detected event), a contributor is unlikely
to need this workflow at all.

## Artefact

The workflow uploads a directory artefact named
`branch-fix-verdict-<slug>-<run_id>` with 30-day retention. The
bundle contains:

| File | Source | Notes |
|---|---|---|
| `branch-fix-verdict.json` | Captured live from `branch_image`. | Always present. Conforms to [Contract v1](./contract-v1.md) and validates against [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json). |
| `original-verdict.json` | Default: fetched from `https://aletheia-works.github.io/vivarium/repro/<project>/<issue_path>/verdict.json` (the `page_url` value from the recipe's entry in `recipes.json`, with `verdict.json` appended). With `original_image`: captured from that image. | Omitted when the deployed Pages snapshot returns 404 (e.g. brand-new recipe not yet on the live site). |

The R.3 comparison-page UI consumes this exact bundle structure;
naming the files this way commits R.2 to a wire format R.3 can
program against without further coordination.

## Comparison summary

The workflow writes a Markdown table to `$GITHUB_STEP_SUMMARY`,
visible on the run page:

| | original | branch-fix |
|---|---|---|
| verdict | (e.g.) `pass` | (e.g.) `fail` |
| exit code | (e.g.) 0 | (e.g.) 1 |

…followed by a one-line "matches expected" / "does NOT match
expected" line for the `expected_verdict` assertion. The Markdown
summary is the at-a-glance view in the workflow run page; for the
side-by-side comparison surface, drop the workflow artefact zip on
the [comparison page](../repro/compare.mdx) (file-drop or paste). The
artefact is the source of truth either way.

## What this pipeline does **not** do

- **Build the branch-fix image.** The contributor is expected to
  build and publish to a registry the runner can pull from. Bundling
  source-build steps would couple the pipeline to an unbounded set
  of upstream toolchains; keeping the image as the input boundary
  matches Phase 3's catalogue model.
- **Verify Layer 1 (WASM) reproductions.** Layer 1 verdicts are
  produced live in-page by a browser; there is no Docker image to
  swap. The Layer 1 equivalent is editing the page sources locally
  and re-running the existing Playwright suite.
- **Verify Layer 3 (rr replay) reproductions on hosted runners.** As
  with the [Consumer workflow](./consumer-workflow.md), GitHub-hosted
  Ubuntu runners cannot drive `rr replay` per
  [ADR-0011](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0011-phase4-first-vertical-rr.md)
  (private memo). Layer 3 branch-fix verification needs a self-hosted
  runner exposing CPUID faulting.
- **Authenticate to private registries.** v1 assumes the supplied
  image ref is anonymously pullable. Adding pull-secret plumbing is
  a deliberate follow-up gated on real demand.

## See also

- [Comparison page](../repro/compare.mdx) — the R.3 side-by-side UI
  that consumes this pipeline's artefact bundle (file-drop, URL
  params, or JSON paste).
- [Contract v1](./contract-v1.md) — the verdict surface this
  pipeline emits and consumes.
- [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json) —
  the schema both bundle entries validate against.
- [Consumer workflow](./consumer-workflow.md) — the sibling
  reusable workflow for verifying a Vivarium recipe in a consumer
  repo's CI; the branch-fix pipeline reuses the same Layer 2
  capture helper internally.
- [Layer 2 catalogue](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker)
  — the slugs available for `inputs.slug`.

Phase 6 sub-stream R.2 per the
[roadmap](../roadmap.md#phase-6--usability-and-visual-layer).
