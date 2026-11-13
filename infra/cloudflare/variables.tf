variable "account_id" {
  type        = string
  description = "The Cloudflare account that holds the zones, the dispatch namespaces and the dispatchers."

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.account_id))
    error_message = "The Cloudflare account ID must be 32 lowercase hexadecimal characters."
  }
}

variable "production_domain" {
  type        = string
  default     = "useren.site"
  description = "The domain of production artifacts."
}

variable "staging_domain" {
  type        = string
  description = "The domain of staging artifacts. It is a separate domain, because the zone's certificate covers one level only."
}

variable "redirect_url" {
  type        = string
  default     = "https://useren.ai"
  description = "Where the bare domain redirects."
}

variable "psl_pull_request" {
  type        = map(string)
  default     = {}
  description = "The Public Suffix List pull request URL of each domain, for its _psl TXT record."
}
