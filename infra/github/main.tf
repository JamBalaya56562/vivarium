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

# Vulnerability alerts are now managed via a dedicated resource
# (provider v6.12.0+). The old `github_repository.vulnerability_alerts`
# attribute has been removed; see Issue #2.
resource "github_repository_vulnerability_alerts" "this" {
  repository = github_repository.this.name
}

# GitHub Pages — Actions workflow source.
# Site is published at https://aletheia-works.github.io/vivarium/.
#
# Migrated from the deprecated nested `github_repository.pages` block.
# The accompanying `import` block below adopts the live Pages config on
# the first apply so the resource is not re-created (which would fail
# because Pages is already enabled on the repository).
resource "github_repository_pages" "this" {
  repository = github_repository.this.name
  build_type = "workflow"
}

# Declarative import (OpenTofu 1.6+) for the live Pages configuration.
# Idempotent once state contains the resource; can be removed in a
# follow-up cleanup PR after the first successful apply.
import {
  to = github_repository_pages.this
  id = var.repository_name
}
