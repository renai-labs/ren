output "name_servers" {
  value = cloudflare_zone.this.name_servers
}

output "namespace" {
  value = cloudflare_workers_for_platforms_dispatch_namespace.this.name
}
