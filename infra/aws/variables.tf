variable "name" {
  type        = string
  default     = "ren-v2-prod"
  description = "Prefix of every resource name, and the ECS cluster name."
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnets in at least two availability zones, for the load balancer and the tasks."

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "A load balancer needs subnets in at least two availability zones."
  }
}

variable "parent_zone_name" {
  type        = string
  description = "Existing public zone that delegates `domain` to the zone this stack makes, for example example.com."
}

variable "domain" {
  type        = string
  description = "The deployment's domain, for example ren.example.com. The app serves on it; api. and egress. are under it."
}

variable "database_security_group_id" {
  type        = string
  description = "Security group of the Postgres instance. This stack adds one ingress rule to it, from the server only."
}

variable "github_repository" {
  type        = string
  description = "The repository whose deploy workflow gets the deploy role, as its OIDC subject names it: owner/name, or owner@id/name@id when the owner uses immutable subjects."
}

variable "github_environment" {
  type        = string
  description = "GitHub environment the deploy job runs in. Only that environment can assume the deploy role."
}

variable "server_secret_keys" {
  type        = list(string)
  description = "Keys of the server secret (Secrets Manager JSON) that become the server's environment."
}

variable "server_environment" {
  type        = map(string)
  default     = {}
  description = "Plain environment values of the server, which are not secret."
}

variable "server_cpu" {
  type    = number
  default = 512
}

variable "server_memory" {
  type    = number
  default = 1024
}

variable "server_desired_count" {
  type        = number
  default     = 0
  description = "0 until the first deploy has pushed an image and the secret has values."
}

variable "egress_instance_type" {
  type    = string
  default = "t4g.small"
}

variable "egress_drain" {
  type        = string
  default     = "30s"
  description = "How long a stopping egress keeps open tunnels. With one copy, new tunnels wait this long during a deploy."
}
