# GitHub provider configuration.
#
# Authentication:
# - Reads a Personal Access Token from the GITHUB_TOKEN environment variable.
# - In GitHub Actions, secrets.TF_TOKEN_GITHUB is passed in via GITHUB_TOKEN.
# - Locally, export GITHUB_TOKEN=github_pat_xxx before running tofu.

provider "github" {
  # owner is defined in variables.tf
  owner = var.github_owner
}
