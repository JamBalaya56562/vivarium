# Vivarium

> A controlled environment for reproducing bugs — any language, any environment, any scale.
> Part of [`aletheia-works`](https://github.com/aletheia-works): surfacing truth in the AI-generated code era.

---

## 🚧 Status

**Phase 0 — Bootstrap**

This project is in the initial setup phase. Infrastructure-as-Code foundations
are being established. Actual product development has not started yet.

See [`docs/docs/roadmap.md`](docs/docs/roadmap.md) for the full plan from Phase 0 to Phase 5.

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

**[aletheia-works.github.io/vivarium](https://aletheia-works.github.io/vivarium)** — vision, roadmap, architecture, ADRs.

Public specification: **[Vivarium Contract v1](https://aletheia-works.github.io/vivarium/spec/contract-v1)** — the reproduction-verdict surface every gallery page emits, with a JSON Schema (`docs/public/spec/verdict.schema.json`) CI validates every Layer 2 / Layer 3 `verdict.json` against.

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

```
vivarium/
├── README.md                 # This file
├── .gitignore
├── .github/
│   ├── workflows/            # CI/CD and automation
│   │   ├── terraform-plan.yml
│   │   ├── terraform-apply.yml
│   │   └── terraform-state-backup.yml
│   └── dependabot.yml        # Automated dependency updates
├── infra/
│   └── github/               # GitHub Settings as Code (OpenTofu)
│       ├── versions.tf
│       ├── providers.tf
│       ├── variables.tf
│       ├── main.tf
│       ├── branch_protection.tf
│       ├── labels.tf
│       └── README.md
├── docs/                     # rspress docs site (config + content)
│   ├── package.json          # rspress + bun deps
│   ├── rspress.config.ts
│   ├── tsconfig.json
│   ├── bun.lock
│   └── docs/                 # markdown content (vision, architecture, ADRs)
└── src/                      # Source code
    └── ...                   # (to be added)
```

## Getting Started

### For Maintainers

See [`infra/github/README.md`](infra/github/README.md) for how to manage
repository settings via OpenTofu.

### For Contributors

The project is not yet accepting contributions — the foundations are still
being laid. Star the repo to follow along.

## Tech Stack (Planned)

| Layer | Technology |
|---|---|
| WASM execution | Pyodide, sqlite-wasm, Rust (wasm32-wasi) |
| Docker execution | devcontainer, Firecracker (exploration) |
| Record-replay | rr, Pernosco-style (long-term) |
| Infrastructure | OpenTofu, GitHub Actions |
| AI agents | Claude Code (implementer and reviewer) |

## License

Apache License 2.0

## Author

Individual developer project.

---

*This README will evolve as the project moves through phases.*
*Current version: Phase 0 — Bootstrap.*
