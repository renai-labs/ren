variable "account_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "domain" {
  type = string
}

variable "redirect_url" {
  type = string
}

variable "psl_pull_request" {
  type    = string
  default = null
}
