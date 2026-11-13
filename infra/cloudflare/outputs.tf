output "name_servers" {
  description = "Set these at each domain's registrar."
  value = {
    (var.production_domain) = module.production.name_servers
    (var.staging_domain)    = module.staging.name_servers
  }
}

output "namespaces" {
  description = "The server's ARTIFACT_CLOUDFLARE_NAMESPACE in each environment."
  value = {
    production = module.production.namespace
    staging    = module.staging.namespace
  }
}
