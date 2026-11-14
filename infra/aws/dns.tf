data "aws_route53_zone" "parent" {
  name = "${var.parent_zone_name}."
}

# Every record of the deployment lives in its own zone. The parent zone gets one record, the
# delegation, and nothing else of the parent changes.
resource "aws_route53_zone" "this" {
  name    = var.domain
  comment = "${var.name}: app, api and egress."
}

resource "aws_route53_record" "delegation" {
  zone_id = data.aws_route53_zone.parent.zone_id
  name    = var.domain
  type    = "NS"
  ttl     = 300
  records = aws_route53_zone.this.name_servers
}

# One certificate for the apex (CloudFront) and every name under it (the load balancer). CloudFront
# accepts only us-east-1 certificates, which is why the stack runs in us-east-1.
resource "aws_acm_certificate" "this" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# The apex and its wildcard validate through one identical record, so only the apex's is made. Keyed
# by domain name, which is known at plan time; the record name is not.
resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.this.domain_validation_options : option.domain_name => option if option.domain_name == var.domain
  }

  zone_id         = aws_route53_zone.this.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  ttl             = 60
  records         = [each.value.resource_record_value]
  allow_overwrite = true

  depends_on = [aws_route53_record.delegation]
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

# The alias domain's certificate covers the apex and every name under it, so it also covers `domain`
# when `domain` is one level under it; CloudFront then serves both names with it.
data "aws_route53_zone" "alias" {
  count = var.alias_domain == null ? 0 : 1

  name = "${var.alias_domain.name}."
}

resource "aws_acm_certificate" "alias" {
  count = var.alias_domain == null ? 0 : 1

  domain_name               = var.alias_domain.name
  subject_alternative_names = ["*.${var.alias_domain.name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = can(regex("^[^.]+\\.${replace(var.alias_domain.name, ".", "\\.")}$", var.domain))
      error_message = "domain must be one level under alias_domain, so that the alias certificate covers both CloudFront names."
    }
  }
}

# Overwrites, not creates: another certificate of the account for the same names validates through
# the same record.
resource "aws_route53_record" "alias_certificate_validation" {
  for_each = {
    for option in try(aws_acm_certificate.alias[0].domain_validation_options, []) : option.domain_name => option if option.domain_name == var.alias_domain.name
  }

  zone_id         = data.aws_route53_zone.alias[0].zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  ttl             = 60
  records         = [each.value.resource_record_value]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "alias" {
  count = var.alias_domain == null ? 0 : 1

  certificate_arn         = aws_acm_certificate.alias[0].arn
  validation_record_fqdns = [for record in aws_route53_record.alias_certificate_validation : record.fqdn]
}

locals {
  alias_published = var.alias_domain == null ? false : var.alias_domain.publish
}

# Overwrites, not creates: the names exist before this stack takes them.
resource "aws_route53_record" "alias_app" {
  for_each = local.alias_published ? toset(["A", "AAAA"]) : toset([])

  zone_id         = data.aws_route53_zone.alias[0].zone_id
  name            = var.alias_domain.name
  type            = each.value
  allow_overwrite = true

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_api" {
  count = local.alias_published ? 1 : 0

  zone_id         = data.aws_route53_zone.alias[0].zone_id
  name            = "api.${var.alias_domain.name}"
  type            = "A"
  allow_overwrite = true

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.this.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "egress" {
  zone_id = aws_route53_zone.this.zone_id
  name    = "egress.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.egress.public_ip]
}

resource "aws_route53_record" "app" {
  for_each = toset(["A", "AAAA"])

  zone_id = aws_route53_zone.this.zone_id
  name    = var.domain
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "posthog_proxy" {
  count = var.posthog_proxy == null ? 0 : 1

  zone_id = aws_route53_zone.this.zone_id
  name    = "${var.posthog_proxy.name}.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.posthog_proxy.target]
}

# Names only the VPC resolves: the server's egress hook, and each egress copy's control address.
resource "aws_service_discovery_private_dns_namespace" "this" {
  name = "${var.name}.internal"
  vpc  = var.vpc_id
}
