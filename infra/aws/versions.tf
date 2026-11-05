terraform {
  required_version = ">= 1.13.1"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72"
    }
    # Only the Cloud Control resource sets a MicroVM image's memory and hooks.
    awscc = {
      source  = "hashicorp/awscc"
      version = "~> 1.108"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.8"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  backend "local" {
    path = "terraform.tfstate"
  }
}
