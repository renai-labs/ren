module "production" {
  source           = "./site"
  account_id       = var.account_id
  environment      = "production"
  domain           = var.production_domain
  redirect_url     = var.redirect_url
  psl_pull_request = lookup(var.psl_pull_request, var.production_domain, null)
}

module "staging" {
  source           = "./site"
  account_id       = var.account_id
  environment      = "staging"
  domain           = var.staging_domain
  redirect_url     = var.redirect_url
  psl_pull_request = lookup(var.psl_pull_request, var.staging_domain, null)
}
