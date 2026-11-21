# The Ren Inference Service: the API and LiteLLM (with the bridge) in one task, in the cluster,
# behind the load balancer. Its code and images live in renai-labs/inference; its deploy workflow
# registers each release as a new revision with only the images changed.
#
# browser ──HTTPS inference.<domain>──▶ load balancer ──▶ inference :4097
# brain (through the egress) ──HTTPS llm.<domain>──▶ load balancer ──▶ litellm :4000
#                  llm.<domain>/v1/catalog, /v1/search, /v1/search/providers ──▶ inference :4097
# Ren server ──HTTP inference.<name>.internal:4097──▶ inference

resource "aws_ecr_repository" "inference" {
  for_each = toset(["inference", "litellm"])

  name                 = "${var.name}-${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "inference" {
  for_each   = aws_ecr_repository.inference
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 20 newest images, so a rollback has targets."
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "inference" {
  name              = "/ecs/${var.name}/inference"
  retention_in_days = 30
}

# Values are set by hand. Terraform never reads or writes them.
resource "aws_secretsmanager_secret" "inference" {
  name = "${var.name}/inference"
}

resource "aws_secretsmanager_secret" "litellm" {
  name = "${var.name}/litellm"
}

resource "aws_iam_role" "inference_execution" {
  name               = "${var.name}-inference-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
}

resource "aws_iam_role_policy_attachment" "inference_execution" {
  role       = aws_iam_role.inference_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "inference_execution_secrets" {
  name = "secrets"
  role = aws_iam_role.inference_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.inference.arn, aws_secretsmanager_secret.litellm.arn]
    }]
  })
}

resource "aws_iam_role" "inference_task" {
  name               = "${var.name}-inference-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
}

resource "aws_security_group" "inference" {
  name_prefix = "${var.name}-inference-"
  description = "${var.name} inference: API and LiteLLM from the load balancer, API from the server."
  vpc_id      = var.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "inference_from_load_balancer" {
  for_each = toset(["4097", "4000"])

  security_group_id            = aws_security_group.inference.id
  referenced_security_group_id = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  description                  = "From the load balancer"
}

resource "aws_vpc_security_group_ingress_rule" "inference_from_server" {
  security_group_id            = aws_security_group.inference.id
  referenced_security_group_id = aws_security_group.server.id
  ip_protocol                  = "tcp"
  from_port                    = 4097
  to_port                      = 4097
  description                  = "API from the Ren server"
}

resource "aws_vpc_security_group_egress_rule" "inference" {
  security_group_id = aws_security_group.inference.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_inference" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.inference.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres from ${var.name} inference"
}

resource "aws_lb_target_group" "inference" {
  name                 = "${var.name}-inference"
  vpc_id               = var.vpc_id
  port                 = 4097
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

resource "aws_lb_target_group" "litellm" {
  name                 = "${var.name}-litellm"
  vpc_id               = var.vpc_id
  port                 = 4000
  protocol             = "HTTP"
  target_type          = "ip"
  deregistration_delay = 120

  health_check {
    path                = "/health/liveliness"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener_rule" "inference" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  condition {
    host_header {
      values = ["inference.${var.domain}"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.inference.arn
  }
}

# The model gateway host is a client's one entry point: the normalized catalog and search routes go to
# the API, every other path (model execution, with streaming, uploads and websockets) goes to LiteLLM
# unchanged. The API serves these routes for whichever host the request named.
resource "aws_lb_listener_rule" "gateway_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 25

  condition {
    host_header {
      values = ["llm.${var.domain}"]
    }
  }

  condition {
    path_pattern {
      values = ["/v1/catalog", "/v1/search", "/v1/search/providers"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.inference.arn
  }
}

resource "aws_lb_listener_rule" "litellm" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30

  condition {
    host_header {
      values = ["llm.${var.domain}"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.litellm.arn
  }
}

resource "aws_route53_record" "inference" {
  for_each = toset(["inference", "llm"])

  zone_id         = data.aws_route53_zone.this.zone_id
  name            = "${each.value}.${var.domain}"
  type            = "A"
  allow_overwrite = true

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}

resource "aws_service_discovery_service" "inference" {
  name = "inference"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

# A change here becomes a new revision that the next inference deploy picks up; the service ignores
# the task definition.
resource "aws_ecs_task_definition" "inference" {
  family                   = "${var.name}-inference"
  cpu                      = var.inference_cpu
  memory                   = var.inference_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.inference_execution.arn
  task_role_arn            = aws_iam_role.inference_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name         = "inference"
      image        = "${aws_ecr_repository.inference["inference"].repository_url}:bootstrap"
      essential    = true
      portMappings = [{ containerPort = 4097, protocol = "tcp" }]
      environment = [
        { name = "PORT", value = "4097" },
        { name = "LITELLM_PROXY_URL", value = "http://localhost:4000" },
        { name = "LITELLM_PUBLIC_URL", value = "https://llm.${var.domain}" },
        { name = "REN_INFERENCE_PUBLIC_URL", value = "https://inference.${var.domain}" },
        { name = "REN_APP_ORIGINS", value = "https://${var.domain}" },
        { name = "POSTHOG_DISABLED", value = "true" },
      ]
      secrets = [
        for key in var.inference_secret_keys : { name = key, valueFrom = "${aws_secretsmanager_secret.inference.arn}:${key}::" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.inference.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "inference"
        }
      }
    },
    {
      name         = "litellm"
      image        = "${aws_ecr_repository.inference["litellm"].repository_url}:bootstrap"
      essential    = true
      portMappings = [{ containerPort = 4000, protocol = "tcp" }]
      stopTimeout  = 120
      environment = [
        { name = "REN_API_URL", value = "http://localhost:4097" },
        { name = "REN_USAGE_URL", value = "https://api.${var.domain}/usage/v1/events" },
        { name = "POSTHOG_DISABLED", value = "true" },
      ]
      secrets = [
        for key in var.litellm_secret_keys : { name = key, valueFrom = "${aws_secretsmanager_secret.litellm.arn}:${key}::" }
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "curl -fsS http://localhost:4000/health/liveliness || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 120
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.inference.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "litellm"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "inference" {
  name                              = "inference"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.inference.arn
  desired_count                     = var.inference_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 300

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.inference.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.inference.arn
    container_name   = "inference"
    container_port   = 4097
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.litellm.arn
    container_name   = "litellm"
    container_port   = 4000
  }

  service_registries {
    registry_arn = aws_service_discovery_service.inference.arn
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

  depends_on = [aws_lb_listener_rule.inference, aws_lb_listener_rule.gateway_api, aws_lb_listener_rule.litellm]
}

# The role renai-labs/inference's deploy workflow assumes through GitHub's OIDC token: only jobs in
# its GitHub environment, and only this service's resources.
data "aws_iam_policy_document" "inference_deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.inference_github_repository}:environment:${var.github_environment}"]
    }
  }
}

resource "aws_iam_role" "inference_deploy" {
  name                 = "${var.name}-inference-deploy"
  assume_role_policy   = data.aws_iam_policy_document.inference_deploy_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "inference_deploy" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for repository in aws_ecr_repository.inference : repository.arn]
  }

  statement {
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }

  statement {
    actions   = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = [aws_ecs_service.inference.id]
  }

  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.inference_execution.arn, aws_iam_role.inference_task.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "inference_deploy" {
  name   = "deploy"
  role   = aws_iam_role.inference_deploy.id
  policy = data.aws_iam_policy_document.inference_deploy.json
}
