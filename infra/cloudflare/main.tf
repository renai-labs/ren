resource "cloudflare_zone" "artifacts" {
  account = { id = var.account_id }
  name    = var.domain
  type    = "full"
}

# Each record points nowhere: the Workers route and the redirect rule answer every request
# before Cloudflare looks for an origin.
resource "cloudflare_dns_record" "wildcard" {
  zone_id = cloudflare_zone.artifacts.id
  name    = "*.${var.domain}"
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "apex" {
  zone_id = cloudflare_zone.artifacts.id
  name    = var.domain
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "psl" {
  count   = var.psl_pull_request == null ? 0 : 1
  zone_id = cloudflare_zone.artifacts.id
  name    = "_psl.${var.domain}"
  type    = "TXT"
  content = "\"${var.psl_pull_request}\""
  ttl     = 1
}

resource "cloudflare_ruleset" "redirect" {
  zone_id = cloudflare_zone.artifacts.id
  name    = "Bare domain"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"
  rules = [{
    description = "Redirect the bare domain"
    expression  = "(http.host eq \"${var.domain}\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = false
        target_url            = { value = var.redirect_url }
      }
    }
  }]
}

resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = cloudflare_zone.artifacts.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = cloudflare_zone.artifacts.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_workers_for_platforms_dispatch_namespace" "artifacts" {
  account_id = var.account_id
  name       = "ren-artifacts"
}

# Which label each artifact name serves. Ren writes it; the dispatcher reads it.
resource "cloudflare_workers_kv_namespace" "names" {
  account_id = var.account_id
  title      = "ren-artifact-names"
}

resource "cloudflare_workers_script" "dispatcher" {
  account_id         = var.account_id
  script_name        = "ren-artifacts-dispatcher"
  content            = file("${path.module}/dispatcher.js")
  main_module        = "dispatcher.js"
  compatibility_date = "2026-06-01"
  bindings = [
    {
      name      = "ARTIFACTS"
      type      = "dispatch_namespace"
      namespace = cloudflare_workers_for_platforms_dispatch_namespace.artifacts.name
    },
    {
      name         = "NAMES"
      type         = "kv_namespace"
      namespace_id = cloudflare_workers_kv_namespace.names.id
    },
    {
      name = "DOMAIN"
      type = "plain_text"
      text = var.domain
    },
  ]
}

# Matches every host under the domain, but not the bare domain, which gets only the redirect.
resource "cloudflare_workers_route" "dispatcher" {
  zone_id = cloudflare_zone.artifacts.id
  pattern = "*.${var.domain}/*"
  script  = cloudflare_workers_script.dispatcher.script_name
}
