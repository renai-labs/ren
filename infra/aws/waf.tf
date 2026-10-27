# The load balancer's firewall: the same rules as ren-v1's ren-alb-waf, owned here so that v1 and
# this deployment change apart.

locals {
  # Body rules count only: they read OAuth callbacks and model requests as attacks (ren-v1 INV-107).
  common_rule_overrides = [
    "SizeRestrictions_BODY",
    "GenericLFI_BODY",
    "GenericRFI_BODY",
    "GenericRFI_QUERYARGUMENTS",
    "CrossSiteScripting_BODY",
    "EC2MetaDataSSRF_BODY",
    "EC2MetaDataSSRF_QUERYARGUMENTS",
    "NoUserAgent_HEADER",
  ]

  # The host a brain sends model requests to.
  brain_inference_host = regex("^https://([^/:]+)", var.server_environment["REN_INFERENCE_BRAIN_URL"])[0]

  # The rate limit skips a request with this label.
  rate_limit_exempt_label = "ren:rate-limit-exempt"
}

resource "aws_wafv2_ip_set" "egress" {
  name               = "${var.name}-egress"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = ["${aws_eip.egress.public_ip}/32"]
}

resource "aws_wafv2_ip_set" "blocked" {
  name               = "${var.name}-blocked"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.blocked_ips
}

resource "aws_wafv2_web_acl" "load_balancer" {
  name  = var.name
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Labels a request from the egress to a host in rate_limit_exempt_hosts. It only counts: the rules
  # after it still apply.
  dynamic "rule" {
    for_each = length(var.rate_limit_exempt_hosts) > 0 ? [join("|", [for host in var.rate_limit_exempt_hosts : replace(lower(host), ".", "\\.")])] : []

    content {
      name     = "rate-limit-exempt"
      priority = 0

      action {
        count {}
      }

      rule_label {
        name = local.rate_limit_exempt_label
      }

      statement {
        and_statement {
          statement {
            regex_match_statement {
              regex_string = "^(${rule.value})$"

              field_to_match {
                single_header {
                  name = "host"
                }
              }

              text_transformation {
                priority = 0
                type     = "LOWERCASE"
              }
            }
          }

          statement {
            ip_set_reference_statement {
              arn = aws_wafv2_ip_set.egress.arn
            }
          }
        }
      }

      visibility_config {
        sampled_requests_enabled   = true
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name}-rate-limit-exempt"
      }
    }
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"

        # Every brain reaches Ren from the egress's one address, so a per-address limit would cap all
        # brains together. Its requests carry the brain's own token; the limit skips them: model
        # requests, the host API (/host/), the host MCP (/mcp), and requests that the
        # rate-limit-exempt rule labels.
        scope_down_statement {
          not_statement {
            statement {
              or_statement {
                statement {
                  byte_match_statement {
                    search_string         = local.brain_inference_host
                    positional_constraint = "EXACTLY"

                    field_to_match {
                      single_header {
                        name = "host"
                      }
                    }

                    text_transformation {
                      priority = 0
                      type     = "LOWERCASE"
                    }
                  }
                }

                statement {
                  byte_match_statement {
                    search_string         = "/host/"
                    positional_constraint = "STARTS_WITH"

                    field_to_match {
                      uri_path {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }

                statement {
                  byte_match_statement {
                    search_string         = "/mcp"
                    positional_constraint = "EXACTLY"

                    field_to_match {
                      uri_path {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }

                statement {
                  label_match_statement {
                    scope = "LABEL"
                    key   = local.rate_limit_exempt_label
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
    }
  }

  rule {
    name     = "blocked-ips"
    priority = 2

    action {
      block {}
    }

    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.blocked.arn
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-blocked-ips"
    }
  }

  rule {
    name     = "aws-common-rules"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        dynamic "rule_action_override" {
          for_each = local.common_rule_overrides

          content {
            name = rule_action_override.value

            action_to_use {
              count {}
            }
          }
        }
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-aws-common-rules"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
  }
}

resource "aws_wafv2_web_acl_association" "load_balancer" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.load_balancer.arn
}
