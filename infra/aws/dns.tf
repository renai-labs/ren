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

# Names only the VPC resolves: the server's egress hook, and each egress copy's control address.
resource "aws_service_discovery_private_dns_namespace" "this" {
  name = "${var.name}.internal"
  vpc  = var.vpc_id
}
