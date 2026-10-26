# The egress (repos/iron-proxy) on its own instance. A fixed address serves two needs: E2B dials it
# for every sandbox connection, and customers allowlist the address that sandbox traffic leaves from.
# One copy; repos/iron-proxy/README.md (Deployment) lists what more copies need.

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_caller_identity" "current" {}

# Release artifacts the instance installs: the egress binary and its install script.
resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.name}-artifacts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "egress_install" {
  bucket = aws_s3_bucket.artifacts.id
  key    = "egress/install.sh"
  content = templatefile("${path.module}/egress/install.sh.tftpl", {
    region = var.region
    bucket = aws_s3_bucket.artifacts.id
    secret = aws_secretsmanager_secret.egress.arn
    hook   = "https://server.${aws_service_discovery_private_dns_namespace.this.name}:4443"
    drain  = var.egress_drain
  })
}

# Values are set by hand (README.md): the egress certificates and the sandbox CA.
resource "aws_secretsmanager_secret" "egress" {
  name = "${var.name}/egress"
}

resource "aws_security_group" "egress" {
  name_prefix = "${var.name}-egress-"
  description = "${var.name} egress: tunnels from anywhere (each needs a proxy login), control from the server."
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

# E2B publishes no address range for sandbox traffic, so the tunnel port is open; the egress accepts
# a tunnel only with a proxy login that Ren issued.
resource "aws_vpc_security_group_ingress_rule" "egress_tunnel" {
  security_group_id = aws_security_group.egress.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 1080
  to_port           = 1080
  description       = "Sandbox tunnels"
}

resource "aws_vpc_security_group_ingress_rule" "egress_control" {
  security_group_id            = aws_security_group.egress.id
  referenced_security_group_id = aws_security_group.server.id
  ip_protocol                  = "tcp"
  from_port                    = 9443
  to_port                      = 9443
  description                  = "Control (mTLS) from the server"
}

resource "aws_vpc_security_group_egress_rule" "egress" {
  security_group_id = aws_security_group.egress.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_iam_role" "egress" {
  name = "${var.name}-egress"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "egress_ssm" {
  role       = aws_iam_role.egress.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "egress" {
  name = "egress"
  role = aws_iam_role.egress.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.egress.arn },
      { Effect = "Allow", Action = "s3:GetObject", Resource = "${aws_s3_bucket.artifacts.arn}/egress/*" },
    ]
  })
}

resource "aws_iam_instance_profile" "egress" {
  name = "${var.name}-egress"
  role = aws_iam_role.egress.name
}

resource "aws_instance" "egress" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.egress_instance_type
  subnet_id                   = var.public_subnet_ids[0]
  iam_instance_profile        = aws_iam_instance_profile.egress.name
  vpc_security_group_ids      = [aws_security_group.egress.id]
  associate_public_ip_address = true

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
  }

  # At boot the instance installs the current release; a release runs the same script through the
  # SSM document below.
  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail
    aws s3 cp --region ${var.region} s3://${aws_s3_bucket.artifacts.id}/egress/install.sh /usr/local/bin/ren-egress-install
    chmod 0755 /usr/local/bin/ren-egress-install
    /usr/local/bin/ren-egress-install
  EOF

  tags = {
    Name = "${var.name}-egress"
  }

  # A new AMI would replace the instance on an unrelated apply. Roll it on purpose instead.
  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_eip" "egress" {
  domain = "vpc"

  tags = {
    Name = "${var.name}-egress"
  }

  # Customers allowlist this address.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_eip_association" "egress" {
  instance_id   = aws_instance.egress.id
  allocation_id = aws_eip.egress.id
}

resource "aws_service_discovery_service" "egress" {
  name = "egress"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

resource "aws_service_discovery_instance" "egress" {
  instance_id = aws_instance.egress.id
  service_id  = aws_service_discovery_service.egress.id

  attributes = {
    AWS_INSTANCE_IPV4 = aws_instance.egress.private_ip
  }
}

# A release: the deploy workflow uploads the binary, moves egress/current to it, and runs this.
resource "aws_ssm_document" "egress_install" {
  name          = "${var.name}-egress-install"
  document_type = "Command"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Install the current egress release and restart the egress."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "install"
      inputs = {
        runCommand = [
          "set -euo pipefail",
          "aws s3 cp --region ${var.region} s3://${aws_s3_bucket.artifacts.id}/egress/install.sh /usr/local/bin/ren-egress-install",
          "chmod 0755 /usr/local/bin/ren-egress-install",
          "/usr/local/bin/ren-egress-install",
        ]
      }
    }]
  })
}
