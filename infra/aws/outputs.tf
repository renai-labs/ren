# Read by the deploy workflow (as GitHub environment variables) and by stacks that join this
# deployment: the cluster, the load balancer, the zone and the private namespace.

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "server_service" {
  value = aws_ecs_service.server.name
}

output "server_task_family" {
  value = aws_ecs_task_definition.server.family
}

output "server_repository_url" {
  value = aws_ecr_repository.server.repository_url
}

output "server_security_group_id" {
  value = aws_security_group.server.id
}

output "load_balancer_security_group_id" {
  value = aws_security_group.load_balancer.id
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "load_balancer_dns_name" {
  value = aws_lb.this.dns_name
}

output "load_balancer_zone_id" {
  value = aws_lb.this.zone_id
}

output "zone_id" {
  value = aws_route53_zone.this.zone_id
}

output "namespace_id" {
  value = aws_service_discovery_private_dns_namespace.this.id
}

output "namespace_name" {
  value = aws_service_discovery_private_dns_namespace.this.name
}

output "app_bucket" {
  value = aws_s3_bucket.app.id
}

output "app_distribution_id" {
  value = aws_cloudfront_distribution.app.id
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.id
}

output "egress_instance_id" {
  value = aws_instance.egress.id
}

output "egress_address" {
  description = "The address sandbox traffic leaves from. Customers allowlist it."
  value       = aws_eip.egress.public_ip
}

output "egress_install_document" {
  value = aws_ssm_document.egress_install.name
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "server_secret_arn" {
  value = aws_secretsmanager_secret.server.arn
}

output "egress_secret_arn" {
  value = aws_secretsmanager_secret.egress.arn
}

output "deploy_secret_arn" {
  value = aws_secretsmanager_secret.deploy.arn
}
