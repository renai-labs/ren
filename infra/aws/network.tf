resource "aws_security_group" "load_balancer" {
  name_prefix = "${var.name}-alb-"
  description = "${var.name} load balancer: HTTPS from anywhere."
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "load_balancer" {
  for_each = toset(["80", "443"])

  security_group_id = aws_security_group.load_balancer.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
}

resource "aws_vpc_security_group_egress_rule" "load_balancer" {
  security_group_id = aws_security_group.load_balancer.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "server" {
  name_prefix = "${var.name}-server-"
  description = "${var.name} server: the API from the load balancer, the egress hook from the egress."
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "server_api" {
  security_group_id            = aws_security_group.server.id
  referenced_security_group_id = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = 4100
  to_port                      = 4100
  description                  = "API from the load balancer"
}

resource "aws_vpc_security_group_ingress_rule" "server_hook" {
  security_group_id            = aws_security_group.server.id
  referenced_security_group_id = aws_security_group.egress.id
  ip_protocol                  = "tcp"
  from_port                    = 4443
  to_port                      = 4443
  description                  = "Egress hook (mTLS) from the egress"
}

resource "aws_vpc_security_group_egress_rule" "server" {
  security_group_id = aws_security_group.server.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# The only change to a resource this stack does not own: one rule on the database's group.
resource "aws_vpc_security_group_ingress_rule" "database_from_server" {
  security_group_id            = var.database_security_group_id
  referenced_security_group_id = aws_security_group.server.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres from ${var.name} server"
}

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.load_balancer.id]
  subnets                    = var.public_subnet_ids
  idle_timeout               = 600
  enable_deletion_protection = true
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this.certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Not Found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}
