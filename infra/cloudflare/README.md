# infra/cloudflare

Terraform for the domain that serves artifacts. The design is in [specs/runtime/artifact-sites.md](../../specs/runtime/artifact-sites.md).

```
browser ──HTTPS <label>.<domain>──▶ route *.<domain>/* ──▶ dispatcher ──ARTIFACTS.get(<label>)──▶ artifact Worker in ren-artifacts
browser ──HTTPS <domain>──▶ redirect rule ──301──▶ redirect_url
```

| File            | Contents                                                                               |
| --------------- | -------------------------------------------------------------------------------------- |
| `dispatcher.js` | The dispatcher Worker                                                                  |
| `main.tf`       | Zone, DNS records, redirect rule, zone settings, dispatch namespace, dispatcher, route |

Terraform owns everything in this stack. Ren owns only the Workers in the namespace and their Durable Objects.

## Rules

1. The rules of `infra/aws` apply: no account in the repository, `terraform.tfvars` next to the state, apply by hand.
2. Terraform's token needs Zone Edit, DNS Edit, Zone Settings Edit, Dynamic Redirect Edit, Workers Routes Edit and Workers Scripts Edit. Give it through `CLOUDFLARE_API_TOKEN`. It is not the server's token.
3. The account needs Workers for Platforms before the first apply.

## Apply

```sh
terraform init -backend-config="bucket=<state bucket>" -backend-config="key=<key>" \
  -backend-config="region=<region>" -backend-config="dynamodb_table=<lock table>"
terraform plan -out=plan && terraform apply plan
```

The `terraform.tfvars` has `account_id` and, after the Public Suffix List pull request, `psl_pull_request`.

After the first apply, set the `name_servers` output at the domain's registrar. Set the server's `ARTIFACT_CLOUDFLARE_NAMESPACE` to the `namespace` output, and `ARTIFACT_DOMAIN` to the domain.
