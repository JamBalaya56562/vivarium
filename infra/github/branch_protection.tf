# Branch protection for main.
#
# Phase 0 is solo development, so this configuration enforces a minimum
# quality bar without being overly strict. The rules will be tightened once
# a community forms in Phase 1 and beyond.

resource "github_branch_protection" "main" {
  repository_id = github_repository.this.node_id
  pattern       = "main"

  # Pull request review requirements.
  # While this is solo development, keep reviews optional so the sole
  # maintainer can self-merge.
  required_pull_request_reviews {
    required_approving_review_count = 0 # Phase 0: 0; Phase 1+: 1
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = false
    require_last_push_approval      = false
  }

  # Required CI checks.
  # Add contexts here as workflows are introduced.
  required_status_checks {
    strict = true
    contexts = [
      # Minimal in Phase 0 — add as workflows come online.
      # "ci/tests",
      # "ci/lint",
      # "terraform/plan",
    ]
  }

  # Whether admins are bound by the same rules (i.e. no admin bypass).
  enforce_admins = false # false while solo; consider true once there's a team.

  # Keep history linear.
  required_linear_history = true
  # Phase 0 uses the squash-into-initial-commit workflow before PRs exist,
  # so force-push is allowed. Flip back to false once the first PR lands
  # (see feedback_early_stage_commits.md).
  allows_force_pushes = true
  allows_deletions    = false

  # Block merging while review conversations remain unresolved.
  require_conversation_resolution = true

  # Require signed commits. Setting true enforces GPG/SSH commit signatures;
  # kept false for solo development pragmatism.
  require_signed_commits = false
}
