# Repository resource.
#
# To bring an existing repository under management, import first:
#   tofu import github_repository.this <repository-name>
#
# For a new repository, `tofu apply` will create it.

resource "github_repository" "this" {
  name        = var.repository_name
  description = var.repository_description
  visibility  = var.repository_visibility
  topics      = var.repository_topics

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
  # NOTE: `vulnerability_alerts` is marked deprecated in provider v6.11.x,
  # pointing to the replacement resource `github_repository_vulnerability_alerts`.
  # That resource was merged to provider `main` on 2026-04-16 (PR #3166) but
  # has not yet shipped in a tagged release. Keep this attribute until the
  # provider ships ≥ v6.12.0, then migrate.
  vulnerability_alerts        = true
  web_commit_signoff_required = true # Enforced at the org level (kept out of TF by lifecycle.ignore_changes=all).

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
    # Do not manage repository attributes via TF — use `gh api` or the GitHub UI.
    # Rationale: integrations/github provider (as of 6.x) always sends
    # web_commit_signoff_required=false in the PATCH body. When the org enforces
    # signoff, this triggers a 422 "Commit signoff is enforced by the organization
    # and cannot be disabled" error, unavoidable even when the attribute is set to true.
    # This resource is kept in state purely so that other resources (labels,
    # branch_protection) can reference it; its attributes are not reconciled.
    ignore_changes = all
  }
}
