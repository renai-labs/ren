# infra/aws

Terraform for one Ren deployment on AWS. The deploy workflow (`.github/workflows/deploy.yml`) releases code into it.

The `cli-release.yml` workflow publishes CLI binaries and the installer under `/ren2/` in the app bucket. CloudFront serves those paths directly; app deploys only replace `/app/`.

```
browser ──HTTPS──▶ CloudFront ──▶ S3 (site, /; app, /app/)
browser ──HTTPS <posthog_proxy.name>.<domain>──▶ PostHog's managed reverse proxy ──▶ PostHog
browser ──HTTPS api.<domain>──▶ load balancer ──▶ ECS service server :4100
browser ──HTTPS POST (form the server signed)──▶ S3 (drives)
server ──E2B API──▶ sandbox (brain + hand) ──every connection, egress.<domain>:1080──▶ egress (EC2) ──▶ internet   (egress_mode = proxy)
sandbox ──credential requests only, HTTPS egress.<domain>:443 (Let's Encrypt certificate)──▶ egress ──▶ internet   (egress_mode = split)
egress ──mTLS server.<name>.internal:4443──▶ server        server ──mTLS egress.<name>.internal:9443──▶ egress
```

| File         | Contents                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------- |
| `dns.tf`     | The deployment's zone and its delegation, the certificate, records, the private namespace |
| `network.tf` | Security groups, the load balancer, one rule on the database's security group             |
| `server.tf`  | ECS cluster, ECR repository, server secret, roles, task definition, service               |
| `egress.tf`  | Egress instance, fixed address, artifacts bucket, egress secret, release SSM document     |
| `waf.tf`     | Load balancer firewall: rate limit (skips brain requests), blocked IPs, AWS rules         |
| `app.tf`     | Site and app bucket and CloudFront distribution                                           |
| `drives.tf`  | Drives bucket, CORS for the app's uploads, the server's access, the `drive-access` role   |
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

| Secret          | Keys                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<name>/server` | Each key in `server_secret_keys`. PEM values (`EGRESS_*`, `NODE_EXTRA_CA_CERTS`) become files at start                                                                                              |
| `<name>/egress` | `ca_cert`, `cert`, `key` (mTLS with the server), `mitm_ca_cert`, `mitm_ca_key` (the sandbox CA); optional `passthrough_hosts`, a JSON array of host names whose tunnels the egress does not decrypt |
| `<name>/deploy` | `E2B_API_KEY`, for the template build; `POSTHOG_CLI_API_KEY`, for the app's source maps (optional)                                                                                                  |

The mTLS certificates: one CA signs a server certificate for `server.<name>.internal` and an egress certificate for `egress.<name>.internal`, both with `serverAuth` and `clientAuth`. The sandbox CA is separate. `repos/iron-proxy/script/certificates.ts` shows the commands.

## Egress mode

`e2b_project_id` is required: the egress serves the identity entry on port 443 in both modes. At its first request, the egress gets a certificate for `egress.<domain>` from Let's Encrypt and keeps it in `/var/lib/ren-egress/acme`. To change `egress_mode`:

1. Set `egress_mode` in `terraform.tfvars`, then apply.
2. Deploy. The server reads the mode at start.
3. Destroy every E2B sandbox with the metadata `owner=<E2B_OWNER>`. A sandbox of the other mode fails its credential requests. Ren replaces each sandbox at its next wake.

## Artifacts on Cloudflare

Register the account's `workers.dev` subdomain and create an account-owned token
with Workers Admin permissions. Store it as `CLOUDFLARE_API_TOKEN` in the existing
server secret, preserving its other keys. Terraform never reads the token value.

Add this to the deployment's private `terraform.tfvars`:

```hcl
artifact_cloudflare = {
  account_id = "<cloudflare-account-id>"
}
```

This selects `ARTIFACT_PROVIDER=cloudflare`, sets `CLOUDFLARE_ACCOUNT_ID`, and
appends the token's Secrets Manager reference to the ECS task. Other environment
values and secret references are preserved. These two environment settings take
precedence over the same keys in `server_environment`. Leaving this variable
unset preserves the existing provider configuration.

The drives bucket expires temporary `artifact-uploads/` objects after seven days.
Retained source archives and provider recovery state are outside that prefix.
The existing server bucket policy covers their access; environments must be able
to reach the bucket endpoint for presigned uploads and downloads.

Plan and apply the stack, then use the release workflow to deploy the server
image and updated task configuration. Applying Terraform does not move the ECS
service to the new task revision. Verify the complete chat-to-public-artifact
flow after deployment; see `docs/artifact-cloudflare.md`.

This setup uses ordinary Workers and stable `workers.dev` URLs. A dedicated
domain (`*.<website_url>`) is an optional follow-up, followed by Workers for
Platforms and its dispatch infrastructure. Neither is required here. Switching
configuration does not migrate existing artifacts between providers/accounts.

## GitHub environment

The deploy workflow runs in the environment that `github_environment` names:

| Kind     | Name                  | Value                                                                                         |
| -------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Secret   | `AWS_DEPLOY_ROLE_ARN` | output `deploy_role_arn`                                                                      |
| Variable | `AWS_REGION`          | `region`                                                                                      |
| Variable | `DEPLOY_NAME`         | `name`                                                                                        |
| Variable | `APP_DISTRIBUTION_ID` | output `app_distribution_id`                                                                  |
| Variable | `EGRESS_INSTANCE_ID`  | output `egress_instance_id`                                                                   |
| Variable | `REN_API_URL`         | `https://api.<domain>`                                                                        |
| Variable | `REN2_HOST_URL`       | CLI release origin, currently `https://v2.useren.ai`                                          |
| Variable | `E2B_TEMPLATE_NAME`   | the brain template's name                                                                     |
| Variable | `E2B_OWNER`           | the owner tag, the same as `E2B_OWNER` of the server                                          |
| Variable | `POSTHOG_PROJECT_KEY` | the PostHog project's `phc_` token, which is public; unset, the site and the app send nothing |
| Variable | `POSTHOG_API_HOST`    | `https://<posthog_proxy.name>.<domain>`                                                       |
| Variable | `POSTHOG_UI_HOST`     | `https://us.posthog.com`, or `https://eu.posthog.com`                                         |
| Variable | `POSTHOG_PROJECT_ID`  | the PostHog project's ID, for the source map upload                                           |
