# Every public name of the deployment is a record in the existing zone of `domain`: the app at the
# apex, api. and egress. under it. One certificate covers the apex (CloudFront) and every name one
# level under it (the load balancer). CloudFront accepts only us-east-1 certificates, which is why the
# stack runs in us-east-1.
data "aws_route53_zone" "this" {
  name = "${var.domain}."
}

resource "aws_acm_certificate" "this" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# The apex and its wildcard validate through one identical record, so only the apex's is made. Keyed
# by domain name, which is known at plan time; the record name is not. Overwrites, not creates:
# another certificate of the account for the same names validates through the same record.
resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.this.domain_validation_options : option.domain_name => option if option.domain_name == var.domain
  }

  zone_id         = data.aws_route53_zone.this.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  ttl             = 60
  records         = [each.value.resource_record_value]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

# Overwrites, not creates: the names existed before this stack took them.
resource "aws_route53_record" "app" {
  for_each = toset(["A", "AAAA"])

  zone_id         = data.aws_route53_zone.this.zone_id
  name            = var.domain
  type            = each.value
  allow_overwrite = true

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = "api.${var.domain}"
  type            = "A"
  allow_overwrite = true

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}

# Sandboxes reach the egress by name and port only; no certificate names it.
resource "aws_route53_record" "egress" {
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = "egress.${var.domain}"
  type            = "A"
  ttl             = 300
  records         = [aws_eip.egress.public_ip]
  allow_overwrite = true
}

resource "aws_route53_record" "posthog_proxy" {
  count = var.posthog_proxy == null ? 0 : 1

  zone_id = data.aws_route53_zone.this.zone_id
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
