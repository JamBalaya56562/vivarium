# Repository-scoped configuration for the vivarium repository.
#
# All repo-scoped resources live here: the repo itself, vulnerability
# alerts, GitHub Pages, branch protection, labels, and milestones.
# Consolidated into a single file because the total surface fits
# comfortably in one place — splitting by resource type costs more in
# navigation than it saves in focus. variables.tf, providers.tf, and
# versions.tf stay separate per the OpenTofu convention.


# ─── Repository ──────────────────────────────────────────────────────
#
# Import (one-time, manual) before the first apply if the repo
# pre-existed this module:
#   tofu import github_repository.this <repository-name>
#
# For a brand-new repository, `tofu apply` creates it.

resource "github_repository" "this" {
  name        = var.repository_name
  description = var.repository_description
  visibility  = var.repository_visibility
  topics      = var.repository_topics

  # About-section homepage URL — mirrors the GitHub UI checkbox
  # "Use your GitHub Pages website".
  #
  # Constructed from var.github_owner + var.repository_name rather than
  # `github_repository_pages.this.html_url` because the latter creates a
  # dependency cycle (github_repository_pages.this depends on
  # github_repository.this.name). The default Pages URL format is
  # https://{owner}.github.io/{repo}/, identical to what html_url would
  # return; if a custom domain is later configured on Pages, update this
  # line at the same time.
  homepage_url = "https://${var.github_owner}.github.io/${var.repository_name}/"

  # Feature toggles
  has_issues      = true
  has_discussions = true
  has_projects    = true
  has_wiki        = false

  # Merge strategy — squash only, to keep history clean.
  allow_merge_commit     = false
  allow_squash_merge     = true
  allow_rebase_merge     = false
  allow_auto_merge       = true
  delete_branch_on_merge = true

  # Security
  # Vulnerability alerts are managed by the dedicated
  # `github_repository_vulnerability_alerts` resource below (provider ≥ v6.12.0).
  web_commit_signoff_required = true

  # Initial branch:
  # For imported repositories, leave auto-init off and match the existing branch.
  # For new repositories, uncomment below to have OpenTofu create main with a license and .gitignore template.
  # auto_init          = true
  # license_template   = "apache-2.0"
  # gitignore_template = "Python"

  # Prevent accidental archival.
  archived = false

  lifecycle {
    # Guard against accidental deletion.
    prevent_destroy = true
    # Pages is now managed by the dedicated `github_repository_pages`
    # resource below. The nested `pages` block on this resource is
    # deprecated upstream and will be removed in a future provider
    # version. Ignore drift on the nested attribute so the dedicated
    # resource is the sole owner.
    ignore_changes = [pages]
  }
}


# ─── Vulnerability alerts ────────────────────────────────────────────
#
# Now managed via a dedicated resource (provider v6.12.0+). The old
# `github_repository.vulnerability_alerts` attribute has been removed;
# see Issue #2.

resource "github_repository_vulnerability_alerts" "this" {
  repository = github_repository.this.name
}


# ─── GitHub Pages ────────────────────────────────────────────────────
#
# Actions workflow source. Site is published at
# https://aletheia-works.github.io/vivarium/.
#
# Migrated from the deprecated nested `github_repository.pages` block.
# The accompanying `import` block below adopts the live Pages config on
# the first apply so the resource is not re-created (which would fail
# because Pages is already enabled on the repository).

resource "github_repository_pages" "this" {
  repository = github_repository.this.name
  build_type = "workflow"
}


# ─── Branch protection ───────────────────────────────────────────────
#
# Phase 1 baseline: enforce review, signed commits, and a stable required
# CI check. Solo development continues, so admin bypass is left enabled
# (`enforce_admins = false`) so the maintainer can still self-merge —
# every other rule applies to non-admin contributors as designed.

resource "github_branch_protection" "main" {
  repository_id = github_repository.this.node_id
  pattern       = "main"

  # Pull request review requirements.
  required_pull_request_reviews {
    required_approving_review_count = 1
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = true
    require_last_push_approval      = false
  }

  # Required CI checks.
  # `check / Commitlint` is the caller-job → reusable-job composition that
  # fires on every pull_request via .github/workflows/commitlint.yml. Add
  # more contexts here as additional always-on workflows come online.
  required_status_checks {
    strict = true
    contexts = [
      "check / Commitlint",
    ]
  }

  # Whether admins are bound by the same rules. Kept off so the sole
  # maintainer can self-merge while solo; flip to true once a second
  # reviewer is available.
  enforce_admins = false

  # Keep history linear.
  required_linear_history = true

  # Phase 1: history rewrites are no longer needed; force-pushes are
  # disallowed across all repos.
  allows_force_pushes = false
  allows_deletions    = false

  # Block merging while review conversations remain unresolved.
  require_conversation_resolution = true

  # Require signed commits (GPG/SSH commit signatures) for every commit
  # merged into the default branch.
  require_signed_commits = true
}


# ─── Labels ──────────────────────────────────────────────────────────
#
# The label taxonomy has four axes:
#   1. type: *     — kind of change (bug, feature, docs, ...)
#   2. scope: *    — area of impact (WASM layer, Docker layer, ...)
#   3. priority: * — priority level
#   4. status: *   — current status
#
# Label names use a "prefix: value" convention (note the space after the
# colon) to read naturally in GitHub's UI and to match the project's
# conventional-commit prefixes.
#
# Colors follow a Material Design-inspired palette for visual consistency.

locals {
  labels = {
    # ─── Type ────────────────────────────────────
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

    # ─── Scope ───────────────────────────────────
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

    # ─── Priority ────────────────────────────────
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

    # ─── Status ──────────────────────────────────
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

    # ─── AI-related ──────────────────────────────
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

    # ─── Community ───────────────────────────────
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


# ─── Milestones ──────────────────────────────────────────────────────
#
# Phase boundaries for the lifelong roadmap.
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
    "Phase 7 — First-30-minutes onboarding" = {
      description = "Turn the Phase 6 surface from 'primitives are usable' into 'a stranger can pick this up cold'. UI brush-up (V′) + onboarding documentation (D) co-defined; AI-slop verification flow (B3) wires R.2 Path A + R.3 + MCP into one walkthrough; A-tail clears Phase 6 deferred items (ajv-standalone migration, match_error v2). Closes when V′ + D + B3 ship; A-tail items are optional. EN+JA same-PR is the i18n default."
      state       = "open"
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
