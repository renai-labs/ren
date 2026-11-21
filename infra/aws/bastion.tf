# A shell inside the VPC for database queries, reached with SSM Session Manager: no key, no inbound port.
# ren-v1 made it; the names keep its ren-prod-bastion prefix, because a new name replaces the role and
# the security group.

resource "aws_iam_role" "bastion" {
  name = "ren-prod-bastion-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "ren-prod-bastion-profile"
  role = aws_iam_role.bastion.name
}

resource "aws_security_group" "bastion" {
  name        = "ren-prod-bastion-sg"
  description = "Bastion egress-only. SSM tunnels inbound traffic over the SSM agent outbound HTTPS connection, so no ingress is needed."
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_egress_rule" "bastion" {
  security_group_id = aws_security_group.bastion.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "All egress (SSM endpoints, RDS, package mirrors)"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_bastion" {
  security_group_id            = var.database_security_group_id
  referenced_security_group_id = aws_security_group.bastion.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres from bastion"
}

# Public, so it reaches the SSM endpoints through the internet gateway without a NAT.
resource "aws_instance" "bastion" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = "t4g.nano"
  subnet_id                   = var.public_subnet_ids[0]
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  associate_public_ip_address = true

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 8
    encrypted             = true
    delete_on_termination = true
  }

  user_data = <<-EOF
    dnf install -y postgresql17
  EOF

  tags = {
    Name = "ren-prod-bastion"
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
