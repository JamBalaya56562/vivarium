resource "github_repository" "this" {
  name        = var.repository_name
  description = var.repository_description
  visibility  = var.repository_visibility
  topics      = var.repository_topics

  homepage_url = "https://${var.github_owner}.github.io/${var.repository_name}/"

  has_issues      = true
  has_discussions = true
  has_projects    = true
  has_wiki        = false

  allow_merge_commit     = false
  allow_squash_merge     = true
  allow_rebase_merge     = false
  allow_auto_merge       = true
  delete_branch_on_merge = true

  web_commit_signoff_required = true

  archived = false

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [pages]
  }
}

resource "github_repository_vulnerability_alerts" "this" {
  repository = github_repository.this.name
}

resource "github_repository_pages" "this" {
  repository = github_repository.this.name
  build_type = "workflow"
}

resource "github_branch_protection" "main" {
  repository_id = github_repository.this.node_id
  pattern       = "main"

  required_pull_request_reviews {
    required_approving_review_count = 1
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = true
    require_last_push_approval      = false
  }

  required_status_checks {
    strict = true
    contexts = [
      "check / Commitlint",
    ]
  }

  enforce_admins = false

  required_linear_history = true

  allows_force_pushes = false
  allows_deletions    = false

  require_conversation_resolution = true

  require_signed_commits = true
}

locals {
  labels = {
    "type: bug" = {
      color       = "d73a4a"
      description = "Something isn't working"
    }
    "type: feature" = {
      color       = "a2eeef"
      description = "New feature or capability"
    }
    "type: docs" = {
      color       = "0075ca"
      description = "Documentation improvements"
    }
    "type: refactor" = {
      color       = "cfd3d7"
      description = "Code refactoring without behavior change"
    }
    "type: test" = {
      color       = "bfdadc"
      description = "Test additions or improvements"
    }
    "type: chore" = {
      color       = "fef2c0"
      description = "Maintenance tasks"
    }

    "scope: wasm" = {
      color       = "6f42c1"
      description = "WASM execution layer"
    }
    "scope: docker" = {
      color       = "2188ff"
      description = "Docker execution layer"
    }
    "scope: python" = {
      color       = "3572a5"
      description = "Python (Pyodide) related"
    }
    "scope: rust" = {
      color       = "dea584"
      description = "Rust related"
    }
    "scope: js" = {
      color       = "f1e05a"
      description = "JavaScript/TypeScript related"
    }
    "scope: infra" = {
      color       = "5319e7"
      description = "Infrastructure as Code"
    }
    "scope: ci" = {
      color       = "ededed"
      description = "CI/CD pipeline"
    }
    "scope: docs" = {
      color       = "c2e0c6"
      description = "Documentation site (rspress) and public spec pages under docs/"
    }
    "scope: ux" = {
      color       = "ff69b4"
      description = "User experience"
    }

    "priority: p0" = {
      color       = "b60205"
      description = "Critical - must fix immediately"
    }
    "priority: p1" = {
      color       = "d93f0b"
      description = "High - important for near-term"
    }
    "priority: p2" = {
      color       = "fbca04"
      description = "Medium - normal priority"
    }
    "priority: p3" = {
      color       = "0e8a16"
      description = "Low - nice to have"
    }

    "status: triage" = {
      color       = "e99695"
      description = "Needs initial triage"
    }
    "status: blocked" = {
      color       = "000000"
      description = "Blocked by something"
    }
    "status: in-progress" = {
      color       = "0052cc"
      description = "Currently being worked on"
    }
    "status: needs-reproduction" = {
      color       = "d876e3"
      description = "Reproduction steps needed"
    }
    "status: apply-failure" = {
      color       = "b60205"
      description = "Auto-filed when Terraform Apply fails on main; auto-closed on recovery"
    }

    "ai: approved" = {
      color       = "0969da"
      description = "Repository owner has authorised AI agents to process this PR"
    }
    "ai: generated" = {
      color       = "00d4aa"
      description = "Created or modified by AI"
    }
    "ai: slop-risk" = {
      color       = "ff4500"
      description = "Potential AI slop - needs extra review"
    }
    "ai: verified" = {
      color       = "28a745"
      description = "AI output verified by human"
    }

    "good-first-issue" = {
      color       = "7057ff"
      description = "Good for newcomers"
    }
    "help-wanted" = {
      color       = "008672"
      description = "Extra attention is needed"
    }
    "discussion" = {
      color       = "d4c5f9"
      description = "Needs community discussion"
    }
  }
}

resource "github_issue_label" "labels" {
  for_each = local.labels

  repository  = github_repository.this.name
  name        = each.key
  color       = each.value.color
  description = each.value.description
}

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
    "Phase 7 — First-30-minutes onboarding" = {
      description = "Turn the Phase 6 surface from 'primitives are usable' into 'a stranger can pick this up cold'. UI brush-up (V′) + onboarding documentation (D) co-defined; AI-slop verification flow (B3) wires R.2 Path A + R.3 + MCP into one walkthrough; A-tail clears Phase 6 deferred items (ajv-standalone migration, match_error v2). Closes when V′ + D + B3 ship; A-tail items are optional. EN+JA same-PR is the i18n default."
      state       = "closed"
      due_date    = "2026-05-08"
    }
    "Phase 8 — Recipe-page desktop layout & self-dogfooding" = {
      description = "Take the usability lens one layer deeper than Phase 7: the reproduction page itself (V″, recipe-page desktop layout — sidebar / multi-pane / horizontal real-estate) plus first real-world validation (W, self-dogfooding by filing upstream PRs / issue comments linking Vivarium reproductions). A-tail watches Phase 7 carry-forward (A3 ajv-standalone trigger, V′ component graduation YAGNI, A4 Pagefind, B1 outreach, B2 catalogue expansion). Closes when V″ + W ship; A-tail items are optional. Upstream PR submission is human-only per AGENTS.md §2. ADR-0032's filing exhausts the AGENTS.md §4.11 pre-adoption carve-out — future v1-internal breaking changes route through v2."
      state       = "open"
    }
  }
}

resource "github_repository_milestone" "phases" {
  for_each = var.create_phase_milestones ? local.milestones : {}

  owner       = var.github_owner
  repository  = github_repository.this.name
  title       = each.key
  description = each.value.description
  state       = lookup(each.value, "state", "open")
  due_date    = lookup(each.value, "due_date", null)
}
