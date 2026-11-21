variable "account_id" {
  type        = string
  description = "The Cloudflare account that holds the zone, the dispatch namespace and the dispatcher."

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.account_id))
    error_message = "The Cloudflare account ID must be 32 lowercase hexadecimal characters."
  }
}

variable "domain" {
  type        = string
  default     = "useren.site"
  description = "The domain of artifacts."
}

variable "redirect_url" {
  type        = string
  default     = "https://useren.ai"
  description = "Where the bare domain redirects."
}

variable "psl_pull_request" {
  type        = string
  default     = null
  description = "The Public Suffix List pull request URL, for the _psl TXT record."
}
