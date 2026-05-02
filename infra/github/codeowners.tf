# CODEOWNERS file for vivarium.
#
# Required for `require_code_owner_reviews = true` in branch_protection.tf
# to have any effect — without a CODEOWNERS file the rule matches no one.
#
# Single owner during solo development. When a maintainer team is created,
# replace the wildcard line with team mentions and split by path
# (e.g. `infra/* @aletheia-works/infra`).

resource "github_repository_file" "codeowners" {
  repository = github_repository.this.name
  branch     = "main"
  file       = ".github/CODEOWNERS"

  content = <<-EOT
    # Managed by OpenTofu — see infra/github/codeowners.tf
    *  @JamBalaya56562
  EOT

  commit_message      = "chore(infra): manage CODEOWNERS via OpenTofu"
  commit_author       = "aletheia-works-bot"
  commit_email        = "aletheia-works-bot@users.noreply.github.com"
  overwrite_on_create = true
}
