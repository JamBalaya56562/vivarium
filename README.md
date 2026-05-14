# Vivarium

> A controlled environment for reproducing bugs — any language, any environment, any scale.
> Part of [`aletheia-works`](https://github.com/aletheia-works): surfacing truth in the AI-generated code era.

## Why This Project Exists

In 2025-2026, open-source maintainers face a new crisis:
**AI-generated bug reports and pull requests — "AI slop" — are flooding issue trackers.**

- cURL ended its bounty program in January 2026 after AI slop reached 95%
- Ghostty, tldraw, Node.js, Godot, Fedora, and others adopted defensive policies
- GitHub officially acknowledged the crisis in February 2026

The root cause: **there's no cheap, universal way to verify whether an AI claim is true.**

This project aims to solve that by providing a unified platform where anyone can
reproduce a bug — in any language, any environment, at any scale — and verify
whether the claim holds.

## Vision

**Universal bug reproduction. Any language, any environment, any scale.**

We don't lock ourselves into a single technology. We combine:

- **WASM** for instant, browser-native reproduction (Pyodide, sqlite-wasm, etc.)
- **Docker** for full-fidelity environment reproduction
- **Third-way approaches** like record-replay and deterministic simulation

The goal is not to be "a WASM service" — the goal is to **reproduce bugs**.
The technology is chosen by the problem, not the other way around.

## Documentation

**[aletheia-works.github.io/vivarium](https://aletheia-works.github.io/vivarium)** — vision, roadmap, architecture, the public spec surface.

Public specs:

- **[Contract v1](https://aletheia-works.github.io/vivarium/spec/contract-v1)** — the reproduction-verdict surface every gallery page emits (revision 2 adds an optional evidence surface). JSON Schema at [`verdict.schema.json`](https://aletheia-works.github.io/vivarium/spec/verdict.schema.json), CI-validated on every Layer 2/3 `verdict.json`.
- **[Manifest v1](https://aletheia-works.github.io/vivarium/spec/manifest-v1)** — TOML manifest an external repo ships at `.vivarium/manifest.toml` to declare a Vivarium-runnable reproduction. JSON Schema at [`manifest.schema.json`](https://aletheia-works.github.io/vivarium/spec/manifest.schema.json).
- **[Recipes index v1](https://aletheia-works.github.io/vivarium/spec/recipes-index-v1)** — machine-readable catalogue listing of every reproduction in this repo. Live endpoint: <https://aletheia-works.github.io/vivarium/api/recipes.json>.

Programmatic access:

- **[`@aletheia-works/vivarium-mcp`](packages/mcp-server/)** — Model Context Protocol server exposing the catalogue + verdict-snapshot reads + branch-fix / fix-candidate scaffolding to AI agent clients (Claude Code, Cline, Cursor, Continue, …). Dual-published to JSR (canonical) and npm (fallback).

The docs site is built with [rspress](https://rspress.rs) and deployed to
GitHub Pages from [`docs/`](docs/) on every push to `main`. The rspress
configuration, scripts, tests, and lockfile live in `docs/`; the site source
itself lives in `docs/site/` (content, components, styles, hand-written data
overlays, generated site-only modules, and public assets).

## Getting Started

### For Maintainers

See [`infra/github/README.md`](infra/github/README.md) for how to manage
repository settings via OpenTofu.

### For Contributors

External contributions land most naturally as **Vivarium-runnable
reproductions in your own repo**: ship a `.vivarium/manifest.toml`
that points at a static page (Layer 1) or a published container image
(Layer 2/3) per the [Manifest v1 spec](https://aletheia-works.github.io/vivarium/spec/manifest-v1).
Three reference manifests live under
[`src/external_examples/`](src/external_examples/), one per layer.

Issue and PR contributions to this repo are also welcome.

## Tech Stack

| Area | Technology |
|---|---|
| Layer 1 (WASM) | Pyodide, Ruby.wasm, php-wasm, Rust `wasm32-wasip1` |
| Layer 2 (Docker) | Docker images published to GHCR per recipe |
| Layer 3 (record-replay) | `rr` replay against trace baked into a GHCR image |
| Docs site | rspress + Bun + GitHub Pages |
| MCP server | TypeScript on Bun, dual-published to JSR + npm with OIDC + Sigstore provenance |
| Infrastructure | OpenTofu, GitHub Actions (SHA-pinned), aletheia-works/.github reusables |
| Local toolchain | mise-en-place pinning bun / opentofu / python / uv / php / ruby / rust |
| AI agents | Claude Code (implementer and reviewer) |

## License

Apache License 2.0
