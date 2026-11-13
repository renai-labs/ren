# Cloudflare artifact hosting

Ren publishes each artifact as a Worker in a Workers for Platforms dispatch
namespace. The artifact is served at `https://<label>.<domain>/`, where the label
is `art-` and the lowercased ID suffix (`Artifact.label`). One dispatcher Worker
sends each request to the Worker that has the label as its name. The
`infra/cloudflare` stack makes the zone, the namespace, the dispatcher and its
route. The design is in [specs/runtime/artifact-sites.md](../specs/runtime/artifact-sites.md).

## Production configuration

Keep the existing database, durable workflow runner and drive/object-storage
configuration. Add these server secrets/settings:

```dotenv
ARTIFACT_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<account-owned-token>
ARTIFACT_CLOUDFLARE_NAMESPACE=ren-artifacts-production
ARTIFACT_DOMAIN=useren.site
```

`ARTIFACT_PROVIDER` defaults to `workerd`. Cloudflare credentials are read only
when `cloudflare` is selected. Nothing needs changing in the brain or artifact
callers. The Cloudflare provider uploads with Cloudflare's direct upload API from
memory: it needs no Node, no Wrangler and no temporary folder. Only the local
`workerd` provider runs Wrangler. One call to Cloudflare has a budget of 2
minutes, its recovery included; recovery alone is capped at 25 seconds, and
`ARTIFACT_CLOUDFLARE_RECOVERY_TIMEOUT` can shorten it for diagnostics.

Before using a new account:

1. Buy Workers for Platforms for the account, then apply `infra/cloudflare`
   (see its README). It outputs the namespace of each environment.
2. Create an account-owned API token scoped to that account, with **Workers
   Scripts Write**. It writes scripts in the namespace. It needs no zone, DNS or
   billing permission: the server never changes the zone.
3. Store the token as a server secret, not in source control or artifact files.
4. The provider keeps its state in Postgres (`artifact.remote`), not in the
   bucket. Source archives need `PutObject`, `GetObject` and `DeleteObject`
   under `artifact-uploads/*` (presigned uploads, which a deploy copies and
   deletes) and `PutObject` and `GetObject` under `<organization>/artifacts/*`
   (the kept copies and presigned downloads). Environments PUT uploads straight
   to the bucket, so its endpoint must be reachable from them. Ren's egress
   passes presigned URLs through unchanged and needs no setting for them; an
   egress that gains a host allowlist must list the bucket's host.
5. Add a lifecycle rule that expires objects under `artifact-uploads/` after
   one day. An upload that no deploy claims, or that a deploy refused, stays
   there until then. Its link takes any size for 15 minutes; a deploy refuses
   an archive over the limits.

Deploy the server with the configuration above. Each new artifact receives a
stable `https://<label>.<domain>/` origin; its configured entry selects the
initial path. Workers for Platforms includes 1000 scripts, then charges for each
more script.

For this repository's AWS/ECS deployment, set `artifact_cloudflare` in
`infra/aws` (see its README, "Artifacts on Cloudflare"). Register and deploy the
new task definition through the existing release flow: a new Secrets Manager key
does not reach a running ECS task.

## Switching a development server

Do not switch an active user's server silently. Drain in-flight artifact work
first. Arrange a restart with the person testing, then set the three variables
above through a private environment file. Use a fresh artifact/session for the
Cloudflare test. Existing workerd artifacts are not migrated. Their updates and
stops require their original provider; the Core checks provider identity before
performing a remote operation. Restoring the original configuration lets pending
stop work finish on its original provider.

The provider also records the account, the namespace and the domain in the
artifact row's provider state. Changing one of them does not migrate existing
artifacts: operations fail closed rather than recreating their state elsewhere.
An artifact published as an ordinary Worker on `workers.dev` (state version 2)
also fails closed, without a retry: Ren cannot update or stop it. A Durable
Object's data belongs to its Worker, so it cannot move into the namespace.

## Deployment, recovery and retention

- Ren accepts deploys, stops and archives asynchronously. Each deploy and each
  stop has a row in `artifact_deployment`; status reads only that row. A durable
  run does the work and gives the row a final status. When the run ends, Ren
  sends the result to the chat that asked; the brain does not poll.
- A platform-owned entrypoint handles a probe header before assets or user
  request handlers. Deploy returns only when the public URL serves the exact
  deployment UUID and an independent random upload proof kept in the provider
  state. The
  expected proof is not sent to the public Worker in a request header or query;
  an old deployment cannot impersonate a known future UUID by echoing it. No
  application path is reserved. Readiness also verifies a normal request to the
  configured entry page, so a probe-only response cannot conceal a route that
  does not serve yet. Stop verifies its ordinary HTTP-410 response. Normal requests remain
  assets-first, and WebSocket upgrades/responses pass through unchanged.
- Worker modules are uploaded without server-side bundling. The generated module
  directory is separate from public assets; an untrusted import cannot pull a
  file out of Ren's filesystem into the deployment. Artifact authors must bundle
  their dependencies into `_worker.js`, except for workerd runtime imports such
  as `cloudflare:workers`.
- Successful same-deployment replay checks that marker and reuses the deployment.
- The provider state is the artifact row's `remote` column: the account, stable
  Worker name, accumulated binding/class map, last publication ETag, and
  references to the immutable compressed source archives. Before each change to
  Cloudflare, the provider saves it with a compare-and-swap on `remote_version`
  (write-ahead), so a run after a crash finds what the last one started. A save
  that lost a race to another run fails as retryable and overwrites nothing.
  `deploy` returns the new state, and the run writes it in its final transaction.
  A stop keeps the state.
- Durable Object namespaces use declarative `exports`: every retained class is
  declared as `{type:"durable-object",storage:"sqlite"}`. Ren never generates
  deletion, rename or transfer entries. Applied additions remain represented
  during recovery/stop even when absent from the restored app's manifest.
- Ren sets `durable_objects.code_update_strategy` to `{mode:"immediate"}` on
  uploads, recovery and stop. Cloudflare's newer default defers active objects
  for up to five minutes, which would let an old object's code/schema keep
  accepting requests after publication. Immediate updates reset active objects;
  clients must reconnect interrupted WebSockets and retry interrupted operations.
  Global rollout is still eventually consistent, so use backwards-compatible
  application/SQL changes. See [Cloudflare's code-update contract](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/).
- Ren reads the remote script ETag, saves its write-ahead state, then
  publishes with `If-Match`. Creation uses `If-None-Match: *`. Cloudflare rejects
  stale writes with HTTP 412. These backend conditions—not process termination,
  an in-memory lock or an S3 lease—fence delayed uploads. Recovery uses a fresh
  embedded proof so its source cannot have an ABA-identical ETag to the previous
  upload. A read from a lagging metadata replica can cause a safe, retryable 412;
  it cannot authorize an overwrite.
- Ren uploads with [direct upload](https://developers.cloudflare.com/workers/static-assets/direct-upload/)
  in three steps: an asset upload session with the manifest, one request for
  each bucket of assets that Cloudflare lacks, then one conditional multipart PUT
  of the metadata and the ES modules. An asset's hash is Wrangler's: blake3 of
  its base64 bytes and its extension, first 32 hex characters. The metadata has
  the fields Wrangler sends, taken from a live deploy. The metadata read, the
  asset upload session and the PUT use the namespace's script endpoints
  (`/workers/dispatch/namespaces/<namespace>/scripts/<label>`); the asset buckets
  go to the account's `/workers/assets/upload`.
- Existing successful binding/class mappings cannot be removed, renamed or
  rebound. A terminated process or failed request does not prove an upload was
  rejected. Recovery therefore keeps pending class intents and can provision
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
  the tombstone prevents serving them. Stop never
  deletes the Worker, DO class, namespace, archive or provider state. A later
  deployment restores the application at the same URL. Already-open connections
  can drain; stop does not forcibly delete live Durable Objects.
- A provider failure says if it is retryable. Network errors, HTTP 5xx and 412
  are; Ren tries them again. Any other failure, and a defect, ends the row as
  `failed` and releases the claim. A stop stops trying after 24 hours. A failed
  stop of an archived artifact can leave its link serving; Ren reports it to the
  error reporter. If bounded recovery fails, its pending archive and intent stay
  in the provider state, and another version cannot publish until that state is
  reconciled. A following stop or run performs the reconciliation.

## Upgrading from S3 provider state

Before this release, the provider kept its state in the drive bucket at
`artifact-provider/cloudflare/<artifact>/state.json`. Drain artifact work first.
After the migration, run the copy once with the server's environment, as a
one-off task:

```sh
bun /repo/packages/core/script/artifact-cloudflare-state.ts          # lists what it copies
bun /repo/packages/core/script/artifact-cloudflare-state.ts --write  # copies
```

It writes only a row whose `remote` is empty or still the old binding, so a
second run changes nothing. Leave the bucket objects in place as a backup.

The archive-reference metadata format is version 2. Earlier local experimental
state containing file maps is rejected explicitly, without modifying its Worker
or SQLite data. Do not delete that metadata to force migration. Use a fresh
artifact for new development tests or migrate the old references deliberately.

Existing format-2 Workers with the old imperative namespace migration history
can transition on their next update, recovery or stop. The retained binding/class
map supplies all live SQLite exports; old history fields are ignored and removed
on the next metadata write. No source archive or namespace is deleted. Cloudflare
documents this as a **one-way** transition: after it succeeds, do not run an older
Ren build that sends a `migrations` array. Roll forward with this implementation
instead. A conditional-write conflict keeps recovery pending rather than trying
an unconditional upload. Format-1 file-map records still need explicit migration.

Application table changes are separate: see [per-object SQL migrations](artifact-sql-migrations.md).

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

After approval, run sequentially from `packages/core`, on the staging namespace:

```sh
REN_ARTIFACT_CLOUDFLARE_LIVE=1 bun test --env-file <private-env-file> ./test/artifacts-cloudflare.slow.test.ts
REN_ARTIFACT_CLOUDFLARE_LIVE=1 bun test --env-file <private-env-file> ./test/artifacts-brain.slow.test.ts
```

The private file contains the account ID, the token,
`ARTIFACT_CLOUDFLARE_NAMESPACE` and `ARTIFACT_DOMAIN`. Set
`REN_ARTIFACT_OTHER_DOMAIN` to the other environment's domain to check that it
does not serve this namespace's artifacts. Use `bun test --env-file`,
not `bun --env-file ... test`: the latter can select the package test script,
whose credential isolation is intentionally unsuitable for a live provider run.
The live tests create Workers and retain them, their recovery metadata and DO
data. Finalizers disable serving. Only the fencing test force-deletes its own
script, which holds no data. The first file checks the fencing (a stale `If-Match`
gets 412), the dispatcher (path and query, unknown labels, other hosts, the bare
domain), a process lost at each save, and report/dashboard/guestbook/realtime,
updates, invalid-source recovery, binding validation, stop and redeploy. The second verifies actual Ren chat tool
execution, accepted results without OpenCode's fallback preview URL, completion
with the real provider URL, public HTTP and an update at the same URL.

For a small diagnostic entrypoint from the repository root:

```sh
REN_ARTIFACT_SMOKE_DRY_RUN=1 bun packages/core/script/artifact-cloudflare-smoke.ts
REN_ARTIFACT_SMOKE_APPROVED=1 \
  bun --env-file <private-env-file> packages/core/script/artifact-cloudflare-smoke.ts
```

Dry-run checks that the Cloudflare credentials are set, without network calls. The approved mode runs the same two real Ren integration files above,
sequentially; it has no second deployment implementation. Local and Cloudflare
tests share report/dashboard and guestbook/SQLite/WebSocket scenarios.

## Still deferred

- Provider/account migration and arbitrary provider registries.
- Names that people choose, customer domains, and sign-in before an artifact
  opens.

Official references: [account tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/),
[dispatch namespace scripts](https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/),
[DO lifecycle/rollback limits](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/),
[WFP limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/limits/).
