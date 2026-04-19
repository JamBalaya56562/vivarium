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

  # ─── GitHub Pages ────────────────────────────────────────────
  # Source = GitHub Actions. The actual build/deploy is wired up in
  # `.github/workflows/deploy-docs.yml` via actions/configure-pages and
  # actions/deploy-pages. Declaring it here keeps the Pages enablement
  # itself under IaC so drift (e.g. someone disabling Pages in the UI)
  # is detected.
  pages {
    build_type = "workflow"
  }

  lifecycle {
    # Guard against accidental deletion.
    prevent_destroy = true
    # Known provider bug: integrations/github v6.x always sends
    # web_commit_signoff_required=false in the repository PATCH body. The
    # aletheia-works org enforces commit signoff, so that PATCH 422s.
    # Ignoring the attribute here is not enough — the provider still
    # includes it in the PATCH — so we also skip the full list of repo
    # attributes it would otherwise try to reconcile. Pages is exempted:
    # the provider manages it via a separate `/pages` API call, so it
    # is reachable independent of the broken PATCH.
    #
    # Migrate back to `ignore_changes = [web_commit_signoff_required]`
    # once provider v6.12+ ships (PR integrations/terraform-provider-github#3166).
    ignore_changes = [
      description,
      visibility,
      topics,
      has_issues,
      has_discussions,
      has_projects,
      has_wiki,
      allow_merge_commit,
      allow_squash_merge,
      allow_rebase_merge,
      allow_auto_merge,
      delete_branch_on_merge,
      vulnerability_alerts,
      web_commit_signoff_required,
      archived,
    ]
  }
}
