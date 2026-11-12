# Artifact providers — remaining work

Ordinary Cloudflare Workers are implemented and configurable at the composition
root. See [the setup and verification guide](../../docs/artifact-cloudflare.md).
The remaining Phase 3 work below is specifically paid Workers for Platforms.

## Tools, binary files and size

OpenCode's artifact tools take file contents only as UTF-8 text
([anomalyco/opencode#62122](https://github.com/anomalyco/opencode/issues/62122)),
and keep each artifact's record in the brain's own OpenCode storage. Of the 116
artifacts in v1, 66 have images or fonts, and 4 are over the old 5 MiB file or
20 MiB total limit. So Ren does not use OpenCode's artifact plugin:

- The cell removes `opencode.tool.artifact` and its `ren.artifact` plugin serves
  OpenCode's tool names and inputs under the `opencode` namespace:
  `artifact_create`, `artifact_update`, `artifact_read` and `artifact_delete`,
  plus `artifact_status`. Create and update also take `directory`, a folder on
  the environment, published with its binary files. Read returns the
  artifact's title, entry and URL from Ren's database (`artifacts.read`), not
  its files as OpenCode's does; with `directory`, a new folder on the
  environment gets every file back. A chat without an environment cannot read
  an artifact's files.
- Bytes never pass through the Host API. `artifacts.upload` gives a presigned
  PUT URL. The executor's `files.pack` uploads a folder as a `.tar.gz` with one
  top-level folder; the cell writes one itself for inline `files`.
  `artifacts.deploy` names the upload, and Ren checks it (at most 2000 files,
  25 MiB each, 200 MiB in all; safe paths; the entry; `ren-artifact.json`),
  copies the version it checked to an immutable key and queues the deployment.
  Uploads sit under `artifact-uploads/`; a deploy deletes its own, and a
  bucket lifecycle rule removes the rest after a day. `artifacts.download`
  gives a presigned GET URL that the executor's `files.unpack` reads.
- An executor without `files.pack` cannot publish a folder; inline files still
  work. The environment must reach the bucket's endpoint.
- People use the public artifacts API (`artifact.list` of a space, newest
  first; `artifact.get`; `artifact.archive`), from the app, the SDK and
  `ren artifacts`. Archiving stops serving the artifact, hides it, and refuses
  its next upload or deploy; Ren keeps its source and data.
- One tool for each job. An agent publishes, reads, stops and follows an
  artifact with the `opencode` tools above, as its brain, and finds the space's
  artifacts with Ren MCP's `artifact_list`, as the person in the chat. Ren MCP
  hides `artifact_get` and `artifact_archive`: `artifact_read` reads, and
  archiving is a person's choice in the app. An agent's `artifact_delete`
  stops serving, and publishing again serves the artifact at the same URL.

When OpenCode takes bytes or file references, Ren removes its plugin, enables
OpenCode's, and registers Ren as an OpenCode artifact provider. The tool names
stay the same, so transcripts and clients do not change. OpenCode would also
need an idea of a deployment that is still in progress, and records that are
not per brain.

### Next: artifacts in the app

1. A `session_id` column on `artifact`, set by the deploy that created it, and
   a chat filter on `artifact.list`, so a chat lists its own artifacts.
2. A chat card for an artifact that a chat created or updated, beside
   `show_file`'s, that reads live status from that API. The tools are in code
   mode, so the agent calls them inside `execute`: find
   `.artifact_create` and `.artifact_update` in the `execute` call's
   `toolCalls` metadata, as `AppConnect` finds `.app_request_connect`, as well
   as a direct `opencode_artifact_create` or `opencode_artifact_update` call.
3. The space's Artifacts page and a chat's artifacts panel, as in v1.
4. The site's artifacts page (`concepts/artifacts.mdx`) describes the
   Artifacts page, its card menu (Open, Copy link, Archive) and
   `ren artifacts get <space-id> <artifact-id>`. Check it against what ships,
   and change one or the other: the CLI takes `ren artifacts get <artifact>`,
   and its help says "slug or ID", although artifacts have no slug.
5. Move v1's artifacts: each one's files into a source archive, a row and a
   deployment, at the same URL where that is possible.

### Next: Wrangler's upload

`ArtifactCloudflareUpload.stage` runs Wrangler against a local stand-in for
Cloudflare's API: it answers Wrangler's lookups, lets it upload assets, captures
its script PUT and refuses the rest, so Ren can publish with its own conditional
PUT. That depends on the request sequence of the Wrangler version in the
catalog. Use a supported packaging or upload interface if Wrangler gains one;
until then, keep the adapter in its own module with a contract test that fails
when an upgrade changes those requests.

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
