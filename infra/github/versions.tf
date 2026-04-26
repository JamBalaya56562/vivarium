terraform {
  # Require OpenTofu 1.6+ (also Terraform 1.6+ compatible).
  required_version = ">= 1.6.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.12"
    }
  }

  # State is stored as a GitHub Actions artifact, so the local backend
  # is used. The workflows download/upload the artifact to emulate a
  # pseudo-remote state.
  backend "local" {
    path = "terraform.tfstate"
  }
}
