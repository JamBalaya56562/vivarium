# Vivarium Manifest v1

> A static manifest an external repository ships at
> `.vivarium/manifest.toml` to declare a Vivarium-runnable
> reproduction.

This is the *upstream* surface — how an external project tells
Vivarium "we host a reproduction; here is where to find it." The
*runtime* surface (DOM verdict, `verdict.json`) is defined
separately in [Contract v1](./contract-v1.md).

## At a glance

A repo declares a Vivarium-compatible reproduction by shipping a
single TOML file at:

```
<repo-root>/.vivarium/manifest.toml
```

```toml
#:schema https://aletheia-works.github.io/vivarium/spec/manifest.schema.json
manifest = "v1"
slug = "bash-local-shadows-exit"
title = "bash: `local` builtin shadows command exit code"
layer = 2

[bug]
project = "bash"
issue = 0
upstream_url = "https://lists.gnu.org/archive/html/bug-bash/"

[layer2]
image = "ghcr.io/example-org/example-bash-local-shadows-exit:latest"
dockerfile = "./Dockerfile"
expected_verdict = "reproduced"
```

A consumer that wants to run the reproduction reads the manifest,
dispatches on `layer`, and follows the per-layer convention
defined below.

## Schema directive

Editors with a TOML language server — for example
[Taplo](https://taplo.tamasfe.dev) and
[Tombi](https://tombi-toml.github.io/tombi) — autocomplete and
validate `manifest.toml` against the JSON Schema when the
manifest opens with a `#:schema` line:

```toml
#:schema https://aletheia-works.github.io/vivarium/spec/manifest.schema.json
manifest = "v1"
…
```

The directive is a TOML comment, so it is invisible to plain
parsers (`tomllib` etc.) and CI validation behaves identically
with or without it. Cargo and pyproject manifests use the same
pattern.

## Required top-level keys

| Key | Type | Notes |
|---|---|---|
| `manifest` | string | Must equal `"v1"`. Version literal. |
| `slug` | string | Kebab-case `^[a-z0-9]+(-[a-z0-9]+)*$`. Identifier for the recipe; matches the `aletheia-works/vivarium` directory-name convention. |
| `layer` | integer | One of `1`, `2`, `3`. Selects which layer-specific table is required (see below). |
| `[bug]` | table | Required. Describes the upstream bug. |
| `[bug] project` | string | Upstream project name (e.g. `"bash"`). |
| `[bug] issue` | integer | Issue number. Use `0` if no upstream issue tracker entry exists. |
| `[bug] upstream_url` | string (URI) | Canonical link to the issue / mailing-list thread / PR / docs page. |

## Optional top-level keys

| Key | Type | Notes |
|---|---|---|
| `title` | string | Short human-readable title. |
| `description` | string | Long-form description; markdown allowed but not interpreted. |

## Layer-specific tables

Exactly one of `[layer1]`, `[layer2]`, `[layer3]` is required —
must match the top-level `layer` integer.

### `[layer1]` — WASM in-browser

```toml
layer = 1

[layer1]
page_url = "https://example.org/repro/some-bug/"
expected_verdict = "reproduced"  # default; optional
```

| Field | Required | Notes |
|---|---|---|
| `page_url` | ✅ | URL of the static reproduction page. The page must conform to [Contract v1](./contract-v1.md) — `<meta name="vivarium-contract" content="v1">` in `<head>`, `__VIVARIUM_VERDICT__` / `__VIVARIUM_RESULT__` globals, and `#verdict[data-verdict]` element. |
| `expected_verdict` | ⏳ | `"reproduced"` (default) or `"unreproduced"`. |

### `[layer2]` — Docker catalogue

```toml
layer = 2

[layer2]
image = "ghcr.io/example-org/example-bash-local-shadows-exit:latest"
dockerfile = "./Dockerfile"  # optional, informational
expected_verdict = "reproduced"
```

| Field | Required | Notes |
|---|---|---|
| `image` | ✅ | Container image reference. Visitors run `docker run <image>`. The default CMD is the recipe's reproduction script; exit code 0 = bug reproduces (`reproduced`). |
| `dockerfile` | ⏳ | Repo-relative path to the source Dockerfile. Informational — Vivarium does not build from it. |
| `expected_verdict` | ⏳ | Default `"reproduced"`. |

### `[layer3]` — Record-replay catalogue

```toml
layer = 3

[layer3]
image = "ghcr.io/example-org/example-recipe-with-trace:latest"
dockerfile = "./Dockerfile"
expected_verdict = "reproduced"
```

| Field | Required | Notes |
|---|---|---|
| `image` | ✅ | Container image reference. Image is expected to **ship with the recorded `rr` trace baked in**; entrypoint runs `rr replay` against the pinned trace. |
| `dockerfile` | ⏳ | Informational. |
| `expected_verdict` | ⏳ | Default `"reproduced"`. |

> ⚠️ Layer 3 replay needs a host with **CPUID-faulting support**
> when the visitor's CPU differs from the recording CPU. GitHub
> Actions hosted Ubuntu runners do not expose this capability.
> Layer 3 manifests are therefore best consumed from self-hosted
> runners or visitor desktops with modern Intel (Ivy Bridge+) /
> recent AMD silicon.

## Verdict semantics

The `expected_verdict` values match the literal names locked in
[Contract v1](./contract-v1.md#verdict-semantics):

- `"reproduced"` ⇒ the upstream bug **reproduces**.
- `"unreproduced"` ⇒ the upstream bug **does not reproduce**.

A page declaring `expected_verdict = "reproduced"` is the common
case — the recipe demonstrates the failure the upstream report
describes. A page declaring `expected_verdict = "unreproduced"` is
a sentinel that intentionally tracks an upstream fix; it goes red
the moment the bug regresses back.

## Versioning

The version is carried in one place:

- `manifest = "v1"` at the top of the document.

Adding fields, removing fields, or changing semantics requires a
v2 manifest spec page, a v2 JSON Schema sibling, and a separate
ADR. Consumers should be free to support v1 and v2 simultaneously
by dispatching on the `manifest` literal.

There is no current v2.

## Conformance

A manifest conforms to Vivarium Manifest v1 when:

1. It is a valid TOML 1.0 document at `.vivarium/manifest.toml`
   in the consuming repo.
2. It validates against
   [`manifest.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/manifest.schema.json)
   after a TOML→JSON conversion.
3. Exactly one of `[layer1]` / `[layer2]` / `[layer3]` is
   present, matching the top-level `layer` integer.
4. The pointed-at artefact (page or image) actually exists and
   produces a Contract-v1-conformant verdict at run time.

Clauses 1–3 are mechanically enforceable via schema validation;
clause 4 is per-recipe.

## Reference implementations

The `aletheia-works/vivarium` repo ships three example manifests
under
[`src/external_examples/`](https://github.com/aletheia-works/vivarium/tree/main/src/external_examples)
— one per layer — all pointing at vivarium's own publicly-deployed
pages and GHCR images, so they are runnable as written rather
than just shape-valid.

CI in `repro-regression.yml` validates every
`src/external_examples/*/.vivarium/manifest.toml` against this
schema on every push and pull request.

## See also

- [Contract v1](./contract-v1.md) — the runtime verdict surface
  this manifest's pointed-at artefact must publish.
- [`manifest.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/manifest.schema.json)
  — JSON Schema (draft 2020-12) for the manifest after TOML→JSON
  conversion.
- [Consumer workflow](./consumer-workflow.md) — the reusable
  GitHub Actions workflow consumers use to verify a manifest's
  declared image in their own CI.
