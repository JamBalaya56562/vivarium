# Milestones — phase boundaries for the lifelong roadmap.
#
# GitHub Projects v2 has no provider resource as of
# integrations/terraform-provider-github v6.11.x (tracking issue #2916),
# so the Project board itself is click-ops. Milestones, however, are a
# stable first-class resource and belong in IaC: they are the phase
# boundaries that humans commit to, and CI / labels / ADRs reference
# them mechanically.
#
# `due_date` is deliberately omitted by default. Phase durations in the
# lifelong roadmap are directional (months → years) rather than
# commitments. Set a concrete date by adding `due_date = "YYYY-MM-DD"`
# under the relevant entry once a phase either acquires a hard target
# or has actually closed — for closed phases, `due_date` doubles as the
# closing marker, paired with `state = "closed"`.
#
# Milestone titles double as the canonical phase label surfaced on
# Issues and PRs; keep them human-readable and prefixed with the phase
# number so the GitHub UI sorts them in order.

locals {
  milestones = {
    "Phase 0 — Bootstrap" = {
      description = "Infrastructure-as-Code foundations, vision and workflow documents, AI-delegation bootstrap. No product code yet."
      state       = "closed"
      due_date    = "2026-04-26"
    }
    "Phase 1 — Layer 1: data processing" = {
      description = "First reproduction domain: Python + SQLite over WASM (Pyodide). Target 10–100 early users; validate the reproduction loop end-to-end."
      state       = "closed"
      due_date    = "2026-04-27"
    }
    "Phase 2 — Layer 1: multi-language" = {
      description = "Extend Layer 1 to Rust (wasm32-wasi), JavaScript, Ruby.wasm, PHP.wasm. Upstream contributions to Pyodide / WASI where gaps block reproduction."
      state       = "closed"
      due_date    = "2026-04-27"
    }
    "Phase 3 — Layer 2: Docker" = {
      description = "Full-fidelity reproduction for arbitrary projects, complex dependencies, and network-dependent bugs via devcontainer / Firecracker."
      state       = "closed"
      due_date    = "2026-04-27"
    }
    "Phase 4 — Layer 3: record-replay & deterministic" = {
      description = "rr / Pernosco-style record-replay and Antithesis-style deterministic simulation for problems Layers 1 and 2 cannot reach."
      state       = "closed"
      due_date    = "2026-04-28"
    }
    "Phase 5 — Ecosystem" = {
      description = "Platform integrations, third-party reproduction definitions, industry standardisation around the bug-reproduction primitive."
      state       = "closed"
      due_date    = "2026-04-29"
    }
    "Phase 6 — Usability and visual layer" = {
      description = "Interaction layer above existing primitives: visual redesign (Claude Design mock + component library), reproduction comparison (branch-fix vs original verdict), search & discoverability, manifest authoring UX, MCP server, i18n. Closes when V + R + at least one of S/M/X/L ships."
      state       = "closed"
      due_date    = "2026-05-02"
    }
  }
}

resource "github_repository_milestone" "phases" {
  for_each = local.milestones

  owner       = var.github_owner
  repository  = github_repository.this.name
  title       = each.key
  description = each.value.description
  state       = lookup(each.value, "state", "open")
  due_date    = lookup(each.value, "due_date", null)
}
