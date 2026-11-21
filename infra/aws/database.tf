# The Postgres instance that Ren, the inference service and the integrations service use. Its
# password was set when it was made and lives in each service's secret; Terraform never changes it.

resource "aws_db_subnet_group" "database" {
  name        = "${var.database_identifier}-subnets"
  description = "Subnets for ${var.database_identifier}"
  subnet_ids  = var.database_subnet_ids
}

resource "aws_security_group" "database" {
  name        = "${var.database_identifier}-sg"
  description = "Postgres ingress for ${var.database_identifier}"
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "database" {
  identifier     = var.database_identifier
  engine         = "postgres"
  engine_version = "17.9"
  instance_class = var.database_instance_class

  allocated_storage     = 100
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "ren"
  username = "postgres"
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.database.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"
  copy_tags_to_snapshot   = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.database_identifier}-final"

  performance_insights_enabled = false
  auto_minor_version_upgrade   = true
  # A size change restarts the instance at apply, not at the next maintenance window.
  apply_immediately = true

  lifecycle {
    ignore_changes = [password, engine_version]
  }
}
