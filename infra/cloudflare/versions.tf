terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.29"
    }
  }

  # Partial configuration: the bucket, key and lock table are given at `terraform init`, so this
  # repository names no account. See README.md.
  backend "s3" {}
}

# The token comes from CLOUDFLARE_API_TOKEN.
provider "cloudflare" {}
