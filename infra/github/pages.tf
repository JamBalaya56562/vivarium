# GitHub Pages enablement (Actions source).
#
# The provider's nested `github_repository.pages` block cannot be used
# right now: every change to the repo resource PATCHes `/repos/{owner}/
# {repo}` with `web_commit_signoff_required=false` hardcoded, which the
# org's enforced signoff rejects with 422 (see `main.tf` lifecycle
# comment). `ignore_changes` does not suppress the PATCH itself — only
# drift detection — so even a pages-only diff triggers the broken call.
#
# Workaround: drive the Pages API directly via `gh` over a
# `terraform_data` provisioner. The Pages endpoint (`/repos/{owner}/
# {repo}/pages`) is separate from the repo PATCH, so it succeeds. The
# provisioner is idempotent (POST on create, PUT on update) so reruns
# are safe.
#
# When integrations/github v6.12+ ships (PR #3166), this file can be
# removed and replaced with a `pages {}` block on `github_repository.this`
# plus `ignore_changes = [web_commit_signoff_required]`.

resource "terraform_data" "pages" {
  # Replace the resource (re-run the provisioner) whenever the desired
  # Pages configuration changes.
  triggers_replace = {
    repository = github_repository.this.name
    build_type = "workflow"
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    # gh auths from $GH_TOKEN (or $GITHUB_TOKEN as fallback), both of
    # which CI sets to TF_TOKEN_GITHUB. The PAT must have the repo-level
    # `Pages` permission (RW) in addition to whatever else this module
    # uses, otherwise the API returns 403.
    command = <<-EOT
      set -euo pipefail
      OWNER='${var.github_owner}'
      REPO='${github_repository.this.name}'

      if gh api "repos/$OWNER/$REPO/pages" >/dev/null 2>&1; then
        echo "Pages already enabled — ensuring build_type=workflow"
        gh api --method PUT \
          -H 'Accept: application/vnd.github+json' \
          "repos/$OWNER/$REPO/pages" \
          -f build_type=workflow
      else
        echo "Pages not enabled — creating with build_type=workflow"
        gh api --method POST \
          -H 'Accept: application/vnd.github+json' \
          "repos/$OWNER/$REPO/pages" \
          -f build_type=workflow
      fi
    EOT
  }
}
