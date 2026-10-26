# infra/aws

Terraform for one Ren deployment on AWS. The deploy workflow (`.github/workflows/deploy.yml`) releases code into it.

```
browser ──HTTPS──▶ CloudFront ──▶ S3 (app, /app/)
browser ──HTTPS api.<domain>──▶ load balancer ──▶ ECS service server :4100
server ──E2B API──▶ sandbox (brain + hand) ──every connection, egress.<domain>:1080──▶ egress (EC2) ──▶ internet
egress ──mTLS server.<name>.internal:4443──▶ server        server ──mTLS egress.<name>.internal:9443──▶ egress
```

| File         | Contents                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------- |
| `dns.tf`     | The deployment's zone and its delegation, the certificate, records, the private namespace |
| `network.tf` | Security groups, the load balancer, one rule on the database's security group             |
| `server.tf`  | ECS cluster, ECR repository, server secret, roles, task definition, service               |
| `egress.tf`  | Egress instance, fixed address, artifacts bucket, egress secret, release SSM document     |
| `app.tf`     | App bucket and CloudFront distribution                                                    |
| `deploy.tf`  | The role the deploy workflow assumes with GitHub OIDC                                     |

## Rules

1. The repository names no account. The backend and the variable values come from outside: keep `terraform.tfvars` next to the state, never in git.
2. Apply by hand from a workstation. Do not run Terraform in CI: its output is public in this repository.
3. Terraform makes the secrets but never writes their values. Set them with `aws secretsmanager put-secret-value`.
4. Terraform owns the task definition's settings; the deploy workflow owns the image. A settings change takes effect at the next deploy.

## Apply

```sh
terraform init -backend-config="bucket=<state bucket>" -backend-config="key=<key>" \
  -backend-config="region=<region>" -backend-config="dynamodb_table=<lock table>"
aws s3 cp s3://<state bucket>/<prefix>/terraform.tfvars .
terraform plan -out=plan && terraform apply plan
```

## Secrets

| Secret          | Keys                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `<name>/server` | Each key in `server_secret_keys`. PEM values (`EGRESS_*`, `NODE_EXTRA_CA_CERTS`) become files at start |
| `<name>/egress` | `ca_cert`, `cert`, `key` (mTLS with the server), `mitm_ca_cert`, `mitm_ca_key` (the sandbox CA)        |
| `<name>/deploy` | `E2B_API_KEY`, for the template build                                                                  |

The mTLS certificates: one CA signs a server certificate for `server.<name>.internal` and an egress certificate for `egress.<name>.internal`, both with `serverAuth` and `clientAuth`. The sandbox CA is separate. `repos/iron-proxy/script/certificates.ts` shows the commands.

## GitHub environment

The deploy workflow runs in the environment that `github_environment` names:

| Kind     | Name                  | Value                                                |
| -------- | --------------------- | ---------------------------------------------------- |
| Secret   | `AWS_DEPLOY_ROLE_ARN` | output `deploy_role_arn`                             |
| Variable | `AWS_REGION`          | `region`                                             |
| Variable | `DEPLOY_NAME`         | `name`                                               |
| Variable | `APP_DISTRIBUTION_ID` | output `app_distribution_id`                         |
| Variable | `EGRESS_INSTANCE_ID`  | output `egress_instance_id`                          |
| Variable | `REN_API_URL`         | `https://api.<domain>`                               |
| Variable | `E2B_TEMPLATE_NAME`   | the brain template's name                            |
| Variable | `E2B_OWNER`           | the owner tag, the same as `E2B_OWNER` of the server |
