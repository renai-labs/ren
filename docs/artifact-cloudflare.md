# Cloudflare artifact hosting

Ren can publish artifacts as ordinary Cloudflare Workers. This works on the
Workers Free plan, subject to its request, script, asset and SQLite limits. It
does not require Workers for Platforms, a dispatch namespace, DNS changes or
`artifacts.useren.ai`. Workers for Platforms dispatch remains separate pending
work; setting `ARTIFACT_CLOUDFLARE_NAMESPACE` currently fails startup explicitly.

## Production configuration

Keep the existing database, durable workflow runner and drive/object-storage
configuration. Add these server secrets/settings:

```dotenv
ARTIFACT_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<account-owned-token>
```

`ARTIFACT_PROVIDER` defaults to `workerd`. Cloudflare credentials are read only
when `cloudflare` is selected. Nothing needs changing in the brain or artifact
callers. The server image includes Node 22 and the installed Wrangler dependency.
For a source checkout, Node must be on `PATH`; `ARTIFACT_NODE` overrides it.
`ARTIFACT_CLOUDFLARE_ROOT` optionally selects the parent staging directory. Each
upload gets a scoped temporary directory that is removed on success, failure or
interruption. Only a bounded diagnostic tail is retained in deployment errors.
Wrangler execution is capped at 55 seconds, with forced termination after three
seconds; recovery is capped at 25 seconds. The corresponding
`ARTIFACT_CLOUDFLARE_UPLOAD_TIMEOUT` and `ARTIFACT_CLOUDFLARE_RECOVERY_TIMEOUT`
settings can shorten those budgets for diagnostics, not extend them.

Before using a new account:

1. Register its free `workers.dev` subdomain under **Workers & Pages**. The
   provider reads it through the API; it does not create or rename it.
2. Create an account-owned API token scoped to that account. The current dashboard
   role is product-level **Workers Admin**: artifacts need permission to create
   Workers, not just edit an already-existing Worker. Legacy API documentation
   calls this **Workers Scripts Write/Edit**. No billing, DNS or zone permissions
   are needed for ordinary `workers.dev` hosting.
3. Store the token as a server secret, not in source control or artifact files.
4. Ensure the server's existing private drive bucket permits `GetObject` and
   conditional `PutObject` under `artifact-provider/cloudflare/*`, in addition to
   its existing source-archive permissions. Preserve this prefix and its backups.

The account-owned smoke token is temporary and expires on November 18, 2026;
production needs its own appropriately managed credential.

Deploy the server with the configuration above. Each new artifact receives a
stable `https://<worker>.<account-subdomain>.workers.dev/` origin; its configured
entry selects the initial path. Ordinary Workers have an account script-count
limit. Plan capacity before offering this at scale; it is not the unlimited
script namespace supplied by paid Workers for Platforms.

For this repository's AWS/ECS deployment, add the provider selection and account
ID to `server_environment`, append `CLOUDFLARE_API_TOKEN` to `server_secret_keys`,
and store that token in the existing `<name>/server` Secrets Manager JSON. Do not
replace the existing environment map or secret-key list. Register/deploy the new
task definition through the existing release flow; merely adding a JSON key does
not inject it into a running ECS task. The existing server drive-bucket policy
already covers the new metadata prefix. No infrastructure changes were applied
during local verification.

## Switching a development server

Do not switch an active user's server silently. Drain in-flight artifact work
first. Arrange a restart with the person testing, then set the three variables
above through a private environment file. Use a fresh artifact/session for the
Cloudflare test. Existing workerd artifacts are not migrated. Their updates and
stops require their original provider; the Core checks provider identity before
performing a remote operation. Restoring the original configuration lets pending
stop work finish on its original provider.

The provider also records account and subdomain identity independently of the
artifact row's active binding. Changing the account/subdomain does not migrate
existing artifacts: operations fail closed rather than recreating their state
in another account. Do not rename the account subdomain after publishing.

## Deployment, recovery and retention

- Ren still accepts deploys asynchronously. The existing durable workflows own
  source archives, deployment status, completion notifications and stop fencing.
- A platform-owned entrypoint handles a probe header before assets or user
  request handlers. Deploy returns only when the public URL serves the exact
  deployment UUID and an independent random upload proof retained in S3. The
  expected proof is not sent to the public Worker in a request header or query;
  an old deployment cannot impersonate a known future UUID by echoing it. No
  application path is reserved. Normal requests remain
  assets-first, and WebSocket upgrades/responses pass through unchanged.
- Worker modules are uploaded without server-side bundling. The generated module
  directory is separate from public assets; an untrusted import cannot pull a
  file out of Ren's filesystem into the deployment. Artifact authors must bundle
  their dependencies into `_worker.js`, except for workerd runtime imports such
  as `cloudflare:workers`.
- Successful same-deployment replay checks that marker and reuses the deployment.
- A conditional-write S3 state object retains the account, stable Worker name,
  full SQLite migration history, last acknowledged remote migration tag, and
  references to the existing immutable compressed source archives. It does not
  duplicate the file map as base64 on every metadata write. A ready pending
  source becomes the active source when Core supplies its committed binding,
  so a lost acknowledgement cannot silently replace the last committed source.
  The write-ahead state survives a runner restart and Core clearing `binding`
  after stop. There is no new database migration or artifact version table.
- Wrangler reconciles the stored migration history with Cloudflare's remote
  `migration_tag`; it does not replay the initial SQLite migration on every
  update. Every upload also appends a unique no-op migration fence. Cloudflare
  rejects a stale migration-tag precondition (HTTP 412), including for Workers
  without DO classes. Metadata reads wait boundedly for an acknowledged tag to
  become visible, rather than mistaking a lagging replica for a newer writer.
  Missing/backwards acknowledged remote history that does not settle is an error.
- Existing successful binding/class mappings cannot be removed, renamed or
  rebound. A terminated process or failed request does not prove an upload was
  rejected. Recovery therefore keeps pending migration intents and can provision
  neutral exports for uncertain additions. Those bindings need not appear in a
  subsequently restored application's manifest; their storage remains retained.
- Recovery republishes the previous source plus neutral, storage-preserving
  exports for newly provisioned classes that were never in a successful app.
  It does not import rejected modules to keep those namespaces alive: top-level
  side effects in rejected code must not break the restored application. A
  later valid deploy can supply those classes normally and access their data.
  It does not use Cloudflare's native rollback across a DO lifecycle
  change, which the platform forbids. Code rollback cannot undo application SQL
  writes already performed by the new code.
- Stop publishes a fenced, platform-owned HTTP-410 tombstone with neutral DO
  exports. It does not import application code or race an independent serving
  flag against an earlier upload. Its last archived assets remain attached, but
  the tombstone prevents serving them. Preview URLs remain disabled. Stop never
  deletes the Worker, DO class, namespace, archive or S3 recovery state. A later
  deployment restores the application at the same URL. Already-open connections
  can drain; stop does not forcibly delete live Durable Objects.
- Ordinary errors are reported as failed deployments, not defects that replay a
  rejected upload indefinitely. If bounded recovery fails, its pending archive
  and intent remain durable, and another version cannot publish until that state
  is reconciled. Interruption closes the process scope; a following stop or
  workflow replay performs the reconciliation. S3 requests have abort signals
  and deadlines, and the child exits if its parent-owned input pipe disappears.

The archive-reference metadata format is version 2. Earlier local experimental
state containing file maps is rejected explicitly, without modifying its Worker
or SQLite data. Do not delete that metadata to force migration. Use a fresh
artifact for new development tests or migrate the old references deliberately.

Never delete a Worker or a DO class to implement stop. Cloudflare's forced
Worker deletion also deletes associated DOs and their data.

## Verification

The opt-in integration tests use a temporary migrated Ren database, the existing
local test object-storage bucket, the real Cloudflare API and real Workers. The
brain test runs a real brain with a scripted model to drive deterministic tool
calls; it does not fake Cloudflare responses. Do not run this against production
Ren data. The test object store must be running (`docker compose up -d` according
to the development guide); these commands do not start or alter the user's dev
server.

After approval for ordinary Free Workers, run sequentially from `packages/core`:

```sh
REN_ARTIFACT_CLOUDFLARE_LIVE=1 bun test --env-file <private-env-file> ./test/artifacts-cloudflare.slow.test.ts
REN_ARTIFACT_CLOUDFLARE_LIVE=1 bun test --env-file <private-env-file> ./test/artifacts-brain.slow.test.ts
```

The private file contains the account ID and token. Use `bun test --env-file`,
not `bun --env-file ... test`: the latter can select the package test script,
whose credential isolation is intentionally unsuitable for a live provider run.
The live tests create Workers and retain them, their recovery metadata and DO
data. Finalizers disable serving; nothing is force-deleted. The first test
exercises report/dashboard/guestbook/realtime, updates, invalid-source recovery,
binding validation, stop and redeploy. The second verifies actual Ren chat tool
execution, accepted results without OpenCode's fallback preview URL, completion
with the real provider URL, public HTTP and an update at the same URL.

For a small diagnostic entrypoint from the repository root:

```sh
REN_ARTIFACT_SMOKE_DRY_RUN=1 bun packages/core/script/artifact-cloudflare-smoke.ts
REN_ARTIFACT_SMOKE_APPROVED=1 \
  bun --env-file <private-env-file> packages/core/script/artifact-cloudflare-smoke.ts
```

Dry-run checks local Node/Wrangler availability without credentials or network
calls. The approved mode runs the same two real Ren integration files above,
sequentially; it has no second deployment implementation. Local and Cloudflare
tests share report/dashboard and guestbook/SQLite/WebSocket scenarios. This
still does not verify paid WFP dispatch.

## Still deferred

- Paid Workers for Platforms dispatch namespaces and their live verification.
- The optional `artifacts.useren.ai` domain, wildcard DNS and dispatch routing.
- Provider/account migration and arbitrary provider registries.

Official references: [account tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/),
[Worker serving toggle](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/),
[DO lifecycle/rollback limits](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/),
[WFP limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/limits/).
