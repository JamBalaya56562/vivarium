# Consumer workflow

> A reusable GitHub Actions workflow that any repo can `uses:` to
> verify a Vivarium-hosted bug reproduction in their own CI —
> without copying any Vivarium internals.

The workflow lives at
[`aletheia-works/.github/.github/workflows/vivarium-verdict.yml`](https://github.com/aletheia-works/.github/blob/main/.github/workflows/vivarium-verdict.yml).
It pulls the published `ghcr.io/aletheia-works/vivarium-<slug>`
image, runs the recipe, captures a `verdict.json` matching
[Contract v1](./contract-v1.md), validates it against the
[published JSON Schema](https://aletheia-works.github.io/vivarium/spec/verdict.schema.json),
and asserts the captured verdict matches what the caller
expected.

## Five-line consumer example

```yaml
jobs:
  bash-issue:
    uses: aletheia-works/.github/.github/workflows/vivarium-verdict.yml@main
    with:
      slug: bash-local-shadows-exit
```

That is the entire integration. A consumer repo's
`.github/workflows/check-bug.yml` can carry many such jobs (one
per recipe to track), each turning into a green / red signal in
their own CI. Slugs are the directory names under
[`src/layer2_docker/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker)
(Layer 2 catalogue) and
[`src/layer3_thirdway/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer3_thirdway)
(Layer 3 catalogue, where the trace is baked into the image).

## Inputs

| Input | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `slug` | string | ✅ | — | Recipe slug, e.g. `bash-local-shadows-exit`. Used to derive the default image tag and to label artefacts and log lines. |
| `image` | string | — | `ghcr.io/aletheia-works/vivarium-<slug>:latest` | Image override. Useful when the consumer wants to pin a specific git-sha tag or test a private fork. |
| `expected_verdict` | string | — | `"pass"` | `"pass"` or `"fail"`. Job fails if the captured verdict differs. Use `"fail"` only if you intentionally track a recipe whose upstream bug has been fixed (sentinel page). |
| `timeout_minutes` | number | — | `5` | Job timeout. Most Layer 2 recipes complete in seconds; the budget exists for image-pull on slow networks. |

## Verdict semantics

`pass` means **the upstream bug reproduces** in this run — the
reproduction is doing its job. `fail` means the bug **does not
reproduce**, usually because the upstream project shipped a fix
the bundled image picked up. This is the inverse of typical
"green CI = good" framing; see
[Contract v1: Verdict semantics](./contract-v1.md#verdict-semantics)
for the full reasoning.

Consumers that want a "this bug is fixed" alert can therefore
write:

```yaml
jobs:
  fixed-detector:
    uses: aletheia-works/.github/.github/workflows/vivarium-verdict.yml@main
    with:
      slug: my-favourite-recipe
      expected_verdict: pass        # default; spelled out for clarity
```

…and the workflow flips red the moment the bug stops reproducing,
which is exactly the upstream-fix-detected signal.

## Artefact

The job uploads the captured `verdict.json` as a workflow
artefact named
`verdict-<slug>-<run_id>` with 30-day retention. Consumer-side
badges and debug flows can fetch the artefact via the GitHub
Actions API.

## What this workflow does **not** do

- **Layer 1 (WASM) verification.** Layer 1 reproductions run
  in-page in a browser; the verdict surface is live DOM /
  JavaScript. CI consumer-side verification of Layer 1 is a
  separate problem and does not benefit from a reusable
  workflow — the Vivarium gallery's Playwright suite is the
  canonical Layer 1 regression check.
- **Layer 3 (rr replay) verification on hosted GHA runners.**
  The `replay` step itself runs as part of the recipe's image
  CMD, so this workflow does drive Layer 3 from the consumer
  side, but **only on runners that expose CPUID faulting** to
  the guest. GitHub-hosted Ubuntu runners do not, per
  [ADR-0011](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0011-phase4-first-vertical-rr.md)
  (private memo). Self-hosted runners on bare metal or
  PMU-exposing KVM are required for Layer 3 consumer verification.

## See also

- [Contract v1](./contract-v1.md) — the verdict surface this
  workflow consumes.
- [`verdict.schema.json`](https://aletheia-works.github.io/vivarium/spec/verdict.schema.json) —
  the schema the workflow validates against.
- [Layer 2 catalogue](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker)
  — the slugs available for `inputs.slug`.
- [Layer 3 catalogue](https://github.com/aletheia-works/vivarium/tree/main/src/layer3_thirdway)
  — additional slugs (rr-replay; runner caveat above).

Phase 5 sub-stream D per
[ADR-0013](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0013-phase5-opener.md)
(private memo). Tracking
[Issue #119](https://github.com/aletheia-works/vivarium/issues/119).
