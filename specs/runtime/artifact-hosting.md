# Artifact providers — remaining work

Ordinary Cloudflare Workers are implemented and configurable at the composition
root. See [the setup and verification guide](../../docs/artifact-cloudflare.md).
The remaining Phase 3 work below is specifically paid Workers for Platforms.

## Phase 3 — Cloudflare for Platforms (deferred)

`ArtifactCloudflare.layer`: upload each artifact as a user Worker to a shared
dispatch namespace (staging and production), with a version tag. Ren's dispatch
Worker routes `<artifact>.<domain>` to it. Confirm the version tag through the
dispatch route before the provider's `deploy` returns. Needs `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, the namespace, and the artifacts domain.

Keep the existing `Artifact.Config.durableObjects` binding-to-exported-class
contract. Provision SQLite Durable Objects with stable artifact/class identity
across updates and stop/redeploy. Existing bindings/classes cannot be removed or
renamed. Use declarative class exports, retaining every provisioned class, rather
than replaying imperative namespace migrations. Stop removes only the deployment;
source archives and application data remain.

Done when switching the layer at the composition root changes no caller and the
report, dashboard, guestbook and realtime room tests pass through the dispatch
route. No provider registry, billing, metering or celld changes in this phase.

### Platform validation (2026-11-11; not shipped)

Official documentation confirms that shared dispatch namespaces support native
SQLite Durable Objects and static assets. Namespace scripts have no account
script-count limit, and Workers for Platforms has no Durable Object namespace
count limit. Namespace Workers deploy all-at-once; gradual deployments are not
supported. Other per-Worker CPU, memory, script-size and asset limits still apply.

- [Bindings](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/)
- [Assets API and Wrangler dispatch upload](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/)
- [Namespace limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/limits/)
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Namespace script deletion](https://developers.cloudflare.com/api/node/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/methods/delete/)
- [Patch namespace script settings](https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/subresources/settings/methods/edit/)

Installed Wrangler 4.149.0 supports declarative `exports` through
`resolveDoLifecyclePayload`. Do not combine that flow with legacy `migrations`.
The ordinary provider uses conditional script PUTs with ETags; validate equivalent
backend fencing on the namespace endpoint before enabling WFP. Reuse retained
class maps and immutable archives rather than adding a second history mechanism.

Two constraints block a literal upload/delete/rollback adapter:

1. Deleting a namespace script with `force` deletes its associated Durable
   Objects. Deleting a class explicitly destroys its namespace and data. Stop
   must **not** delete the state-bearing script, class, or namespace. The smallest
   adjustment is to retain the script and disable serving in a platform-owned
   entrypoint, or remove its dispatch routing using durable routing state.
2. Cloudflare does not support native rollback across a Durable Object lifecycle
   change. An update that adds a class, succeeds at the control plane, then fails
   route readiness cannot simply roll back to the previous version. It must keep
   the newly provisioned class/namespace while restoring the previous application
   entrypoint and assets. This needs retained source/export implementations and a
   durable recovery plan, not a request-local best-effort undo. Restoring code
   cannot undo application data writes made by an unsuccessful deployment.

Keep provider state separately from Ren's active `binding`, which Core clears on
stop. Preserve the binding/class map even for a pending update whose remote
outcome is unknown. Reuse the ordinary provider's S3 write intents and conditional
publication model, but do not assume the namespaced API has identical conditional
write semantics until tested. No additional artifact history table or provider
registry is necessary.

Readiness must go through the public dispatch URL and return a deployment UUID
from platform-owned code before user code or asset routing runs. A user response
header alone is not proof. A probe header intercepted by that code avoids
reserving an application path. The dispatcher must pass WebSocket upgrades and
their responses through unchanged. Normal requests retain assets-first behavior.

### Live setup and checks still required

`ArtifactCloudflare.layer` currently supports ordinary Workers only, with an
`ARTIFACT_PROVIDER=workerd|cloudflare` switch (default `workerd`). A dispatch
namespace is deliberately rejected at startup until the WFP adapter exists.
WFP configuration will need `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, a shared dispatch namespace, and an artifacts domain;
staging and production must use distinct namespaces/domains. Do not point an
existing local artifact at another provider implicitly.

Before any live command, obtain approval for the target account, Workers for
Platforms paid plan/charges, namespace creation, dispatch Worker deployment,
wildcard DNS/zone route changes, and sample Worker/SQLite data creation. Use a
scoped account API token with **Workers Scripts Write** for script/settings
operations and namespace administration. Separate
setup permissions (**Workers Routes Write** and **DNS Write** on the chosen zone)
from the runtime token; verify accepted permissions against each API endpoint.
Supply credentials through the secret environment, never checked-in config.
The newer dashboard role model calls Worker-creation access product-level
**Workers Admin**; existing-Worker-only Editor access cannot create new scripts.
[Account-owned tokens support Workers and Durable Objects](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/).
Always supply the account ID explicitly, including when using Wrangler, rather
than relying on user-membership discovery with an account-owned token.

Approved setup will need commands equivalent to:

```sh
curl --fail-with-body --request POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/dispatch/namespaces" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"ren-artifacts-staging"}'
```

Bind the dispatch Worker to that namespace, configure its exact artifacts domain,
and route `*.<artifacts-domain>/*` to it with proxied wildcard DNS. Do not use
Workers custom domains as a replacement for a wildcard zone route. The exact
Worker config/deploy command and opt-in WFP integration runner remain pending
the dispatch adapter; the command above is **not** an
instruction to create resources without approval.

Before marking Phase 3 shipped, run unchanged dashboard, report, guestbook and
realtime-room sources through that route. Verify static content, dynamic API,
SQLite writes, WebSocket bidirectional traffic, updates with stable URLs, stop
and redeploy with retained data, rejected binding changes, matching version
readiness, failed readiness recovery, and process-loss replay before/after each
remote write. Live WFP verification has not run. Ordinary Worker tests do not
substitute for that verification, even when they use the real Cloudflare API.

## Phase 4 — user-supplied providers

A provider registry, configuration, credential validation, and selection per
artifact. Provider migration is a separate operation.
