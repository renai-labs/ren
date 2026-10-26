terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Partial configuration: the bucket, key and lock table are given at `terraform init`, so this
  # repository names no account. See README.md.
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.name
      ManagedBy   = "terraform"
      Environment = "prod"
    }
  }
}
