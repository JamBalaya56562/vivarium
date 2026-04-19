# Issue / PR label definitions.
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
    "ai: escalated" = {
      color       = "ff8c00"
      description = "AI agent reached iteration cap; escalated to human review"
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
