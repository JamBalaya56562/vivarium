# Vivarium

> A controlled environment for reproducing bugs — any language, any environment, any scale.
> Part of [`aletheia-works`](https://github.com/aletheia-works): surfacing truth in the AI-generated code era.

---

## 🚧 Status

## Phase 6 — Usability and visual layer (in flight)

Phases 0–5 closed between 2026-04-26 and 2026-04-29. Layer 1 ships six
WASM verticals (Python via Pyodide, Ruby.wasm, php-wasm, Rust on
`wasm32-wasip1`); Layer 2 ships four Docker recipes published to
`ghcr.io/aletheia-works/`; Layer 3 ships one `rr` recipe. Public specs
(**Contract v1**, **Manifest v1**, **Recipes index v1**) and a
**Vivarium MCP server** for AI agent clients are published.

See [`docs/docs/roadmap.md`](docs/docs/roadmap.md) for the per-phase plan.

---

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

- **[`@aletheia-works/vivarium-mcp`](packages/mcp-server/)** — Model Context Protocol server exposing `list_recipes` / `get_recipe` / `lookup_verdict` to AI agent clients (Claude Code, Cline, Cursor, Continue, …). Dual-published to JSR (canonical) and npm (fallback).

The docs site is built with [rspress](https://rspress.rs) and deployed to GitHub Pages from [`docs/`](docs/) on every push to `main`. The rspress configuration and lockfile live in `docs/`; the markdown content lives in `docs/docs/`.

## Development Philosophy

This project is developed using an **AI-delegated workflow**:

1. Humans define vision, direction, and make strategic decisions
2. AI agents (Claude Code) implement and review in two distinct workflows,
   with the human merging
3. Automation infrastructure (GitHub Actions, Dependabot) runs continuously

The project eats its own dog food:
**an AI-slop-verification platform, developed by AI, reviewed by AI, with humans in the loop.**

## Repository Structure

```text
vivarium/
├── README.md                 # This file
├── AGENTS.md                 # Standing instructions for AI coding agents
├── CLAUDE.md                 # Claude Code-specific addenda
├── mise.toml                 # Tool versions (bun, opentofu, python, ruby, php, rust)
├── .gitignore
├── .github/
│   ├── workflows/            # CI/CD — thin callers into aletheia-works/.github reusables
│   ├── labeler.yml           # Path-based label rules
│   └── dependabot.yml        # Automated dependency updates (github-actions, terraform, bun)
├── infra/
│   └── github/               # GitHub Settings as Code (OpenTofu)
│       ├── milestones.tf, labels.tf, branch_protection.tf, …
│       └── README.md
├── docs/                     # rspress docs site
│   ├── public/spec/          # JSON Schemas — verdict.schema.json, manifest.schema.json
│   ├── public/api/           # recipes.json, recipes.schema.json
│   ├── scripts/              # build-time scripts (recipes-index generator)
│   └── docs/                 # vision, architecture, roadmap, spec/, repro/
├── packages/
│   └── mcp-server/           # @aletheia-works/vivarium-mcp (JSR + npm dual publish)
└── src/
    ├── layer1_wasm/          # 6 Layer 1 recipes (Pyodide, Ruby.wasm, php-wasm, Rust)
    ├── layer2_docker/        # 4 Layer 2 recipes (Docker images on GHCR)
    ├── layer3_thirdway/      # 1 Layer 3 recipe (rr replay)
    └── external_examples/    # reference Manifest v1 fixtures, one per layer
```

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

## Author

Individual developer project.

---

*This README evolves as the project moves through phases.*
*Current phase: Phase 6.*
