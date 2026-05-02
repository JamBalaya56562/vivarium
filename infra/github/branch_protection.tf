# Branch protection for main.
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
