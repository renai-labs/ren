output "name_servers" {
  description = "Set these at the domain's registrar."
  value       = cloudflare_zone.artifacts.name_servers
}

output "namespace" {
  description = "The server's ARTIFACT_CLOUDFLARE_NAMESPACE."
  value       = cloudflare_workers_for_platforms_dispatch_namespace.artifacts.name
}

output "names_namespace" {
  description = "The server's ARTIFACT_CLOUDFLARE_NAMES."
  value       = cloudflare_workers_kv_namespace.names.id
}
