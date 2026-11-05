provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "vivarium"
      ManagedBy = "opentofu"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "vivarium"
      ManagedBy = "opentofu"
    }
  }
}

provider "awscc" {
  region = var.aws_region
}
