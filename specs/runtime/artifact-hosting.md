# Artifact providers

Status: Phase 1 in progress. Phase 3 waits for a Cloudflare account.

## 1. Goal

Let a person use Ren to build, test, and publish an application.
Return a URL that opens the application in a browser.
Let the person change the application and publish a new version.

Use one provider service with two layers. Both run the same package in workerd:

| Layer                      | Where the application runs                                   | Use              |
| -------------------------- | ------------------------------------------------------------ | ---------------- |
| `ArtifactWorkerd.layer`    | `wrangler dev` on the machine that runs Ren                  | Tests, local dev |
| `ArtifactCloudflare.layer` | Workers for Platforms under a Ren-managed Cloudflare account | Production       |

Users never need a Cloudflare account. Allow user-supplied providers in a later phase.
Billing, metering, celld, and user-supplied provider setup are out of scope.
Remove each part of this spec when that part ships.

### Decision: no E2B layer

An earlier draft ran local applications inside the brain's E2B sandbox. Rejected:
the sandbox's executor answers only on loopback, the executor kills a process that
nobody heartbeats for 30 s, and Core would have to drive the brain through new
Brain API calls. All of that wiring exists only for a test provider. The agent
still runs `wrangler dev` in its own sandbox to test before it publishes; that is
the build step, not hosting.

## 2. Terms

| Term       | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| Artifact   | One published application. This is not Ren's integration `App`.        |
| Deployment | One attempt to run the application's files on its provider.            |
| Provider   | The service that runs a published version and gives it a URL.          |
| Harness    | OpenCode. It names each new artifact (`art_…`), and Ren keeps that id. |

## 3. Ownership

- Core (`Artifacts.Service`) owns the artifact and its saved files. Durable
  workflows own deployment input, progress and results.
  Callers never branch on the provider.
- `ArtifactProvider.Service` deploys the files. It gets the artifact ID, deployment
  ID, config and files, and returns an opaque binding and a URL.
- The brain's OpenCode plugin is a thin adapter over the Ren Host API. It holds no
  provider credentials.
- Access is by space: a brain reads, publishes and removes only artifacts of the
  space its host token names. An id taken in another space is a `Conflict`.

## 4. Files (`@ren/schema/artifact`)

- Every file except `_worker.js` is served as it is. `_headers` and `_redirects`
  work as on Cloudflare.
- `_worker.js`, when present, is an ES module Worker. Files match first; the
  Worker gets every other request and reaches the files through `env.ASSETS`.
- Paths are `Drive.Path`s. Limits: 500 files, 5 MiB per file, 20 MiB in total.
- The entry is one of the files.

## 5. Provider contract (`@ren/core/artifact-provider`)

| Operation | Input                                                 | Result                                       |
| --------- | ----------------------------------------------------- | -------------------------------------------- |
| `deploy`  | Artifact, deployment, config, files, previous binding | Binding and URL, after the deployment serves |
| `stop`    | Artifact ID and optional binding                      | Deployment stopped; source and data kept     |

Rules:

1. The provider's `deploy` returns only when the deployment answers requests.
   Core runs it in a durable workflow, outside the request that accepts the deployment.
2. If the new version fails to start, the previous version keeps serving.
3. The URL stays the same across updates of one artifact.
4. Application data survives code updates (`--persist-to` in the workerd layer).
5. `stop` is repeatable.

## 6. Domain rules (`@ren/core/artifacts`)

Ren keeps one row per artifact: identity and ownership, title, provider,
`code_archive`, `config`, `binding`, `url`, `active_deployment_id` and timestamps.
`config.entry` names the file to open. Config is input; binding is the provider's
output, following the environment provider convention.

`code_archive` is the S3 location of the saved application files, packaged as one
`.tar.gz` under `<org>/artifacts/<artifact>/<deployment>/`. Packaging keeps all
files together for storage and deployment; it does not mean version history.
No code is stored in Postgres.

The artifact row does not store deployment status, errors or a second source
deployment ID. Workflow storage holds the candidate code archive, config and
result for each deployment. The workflow key includes artifact ID and deployment
ID; a completed key is not reused for a new deployment.

Deploy:

1. Check ownership and store the candidate files in S3. In one SQL transaction,
   claim the artifact and enqueue the deployment with its immutable input and a
   settlement job. A rollback removes both the claim and the queued work.
2. Return `202 Accepted` with artifact and deployment IDs before provider startup.
3. Allow only one active deployment per artifact. Claiming active work and
   persisting its input must be crash-safe; no recovery path may depend on input
   that existed only in the lost HTTP request.
4. The workflow calls `provider.deploy`. Success updates the saved code, config,
   binding and URL. Failure preserves the last successful source and records the
   error in the workflow result.
5. The settlement job clears the active pointer only after the workflow result
   is durable, and only if the pointer still identifies this work.

Stop takes a separate active claim and settles any active deployment before
removing the provider deployment. Its settlement job clears the stop claim only
after cleanup finishes; the stop request waits for this cleanup. A
new deployment cannot race this cleanup. Keep the artifact row, S3 code, local
code, config and application data. Stopping an unknown artifact or an already
stopped deployment succeeds. A new deployment can start it again.
Deleting a chat or a brain does not remove its artifacts.

## 7. Host API and OpenCode

`RenHostApi` group `artifacts`, keyed by the artifact id:

| Endpoint                                            | Does                                            |
| --------------------------------------------------- | ----------------------------------------------- |
| `PUT /host/artifacts/:id`                           | Store source and accept a background deployment |
| `GET /host/artifacts/:id/deployments/:deploymentId` | That deployment's progress or final result      |
| `GET /host/artifacts/:id/files`                     | Last published files, even after stopping       |
| `DELETE /host/artifacts/:id`                        | Stop the deployment; keep source and data       |

The plugin registers provider `ren` with `ctx.experimental.artifact.transform`,
makes it the default, and turns on OpenCode's `experimental.artifacts` flag. It
sends one deployment ID per tool call and retries a lost response with the same ID.
Tool results explicitly say the deployment was accepted, not that it is live.
The `artifact_status` tool exposes status without making the agent wait. A
persisted plugin watch sends a synthetic completion message to the originating
chat when that deployment finishes. Notification retries reuse
the same message ID, and the watch resumes after a brain restart.

Later, with the first screen that needs them: version history, live health checks,
the chat that made an artifact, and a public API.

## 8. Phases

### Phase 1 — contracts and the workerd layer

Schema, tables, `Artifacts`, `ArtifactProvider`, the workerd layer, the Host API
group, and the OpenCode adapter.

Done when: a chat publishes a Static package, reads it, updates it, and removes it,
through Ren, with the workerd layer.

### Phase 2 — applications

Build a static report, an API dashboard (`server-code`), a CRUD guestbook, and a
realtime room through Ren. Select the state API (`sqlite` through D1 or a Durable
Object's SQLite) only when its profile passes. Test retries, failures, updates that
keep data, and removal.

### Phase 3 — Cloudflare

`ArtifactCloudflare.layer`: upload each artifact as a user Worker to a shared
dispatch namespace (staging and production), with a version tag. Ren's dispatch
Worker routes `<artifact>.<domain>` to it. Confirm the version tag through the
dispatch route before the provider's `deploy` returns. Needs `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, the namespace, and the artifacts domain.

Done when: switching the layer at the composition root changes no caller and
the Phase 2 applications pass.

### Phase 4 — user-supplied providers

A provider registry, configuration, credential validation, and selection per
artifact. Provider migration is a separate operation.
