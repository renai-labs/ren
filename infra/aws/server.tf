resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecr_repository" "server" {
  name                 = "${var.name}-server"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "server" {
  repository = aws_ecr_repository.server.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 20 newest images, so a rollback has targets."
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${var.name}/server"
  retention_in_days = 30
}

# Values are set by hand (README.md). Terraform makes the secret and never reads or writes its value.
resource "aws_secretsmanager_secret" "server" {
  name = "${var.name}/server"
}

data "aws_iam_policy_document" "ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "server_execution" {
  name               = "${var.name}-server-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
}

resource "aws_iam_role_policy_attachment" "server_execution" {
  role       = aws_iam_role.server_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The execution role reads this deployment's server secret and nothing else.
resource "aws_iam_role_policy" "server_execution_secret" {
  name = "server-secret"
  role = aws_iam_role.server_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.server.arn
    }]
  })
}

# The server calls no AWS API, so its task role has no permissions.
resource "aws_iam_role" "server_task" {
  name               = "${var.name}-server-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
}

resource "aws_lb_target_group" "server" {
  name                 = "${var.name}-server"
  vpc_id               = var.vpc_id
  port                 = 4100
  protocol             = "HTTP"
  target_type          = "ip"
  deregistration_delay = 30

  health_check {
    path                = "/health"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener_rule" "server" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    host_header {
      values = ["api.${var.domain}"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
}

resource "aws_service_discovery_service" "server" {
  name = "server"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

# The deploy workflow registers each release as a new revision of this family with only the image
# changed, and moves the service to it. A change here becomes a new revision that the next deploy
# picks up; the service itself ignores the task definition.
resource "aws_ecs_task_definition" "server" {
  family                   = "${var.name}-server"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.server_execution.arn
  task_role_arn            = aws_iam_role.server_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name         = "server"
    image        = "${aws_ecr_repository.server.repository_url}:bootstrap"
    essential    = true
    portMappings = [{ containerPort = 4100, protocol = "tcp" }, { containerPort = 4443, protocol = "tcp" }]
    environment = [
      for key, value in merge(var.server_environment, { PORT = "4100", EGRESS_PORT = "4443" }) : { name = key, value = value }
    ]
    secrets = [
      for key in var.server_secret_keys : { name = key, valueFrom = "${aws_secretsmanager_secret.server.arn}:${key}::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.server.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "server"
      }
    }
  }])
}

resource "aws_ecs_service" "server" {
  name                              = "server"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.server.arn
  desired_count                     = var.server_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 120

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.server.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = 4100
  }

  service_registries {
    registry_arn = aws_service_discovery_service.server.arn
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener_rule.server]
}
