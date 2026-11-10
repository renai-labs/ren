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

| Term     | Meaning                                                                |
| -------- | ---------------------------------------------------------------------- |
| Artifact | One published application. This is not Ren's integration `App`.        |
| Provider | The service that runs a published version and gives it a URL.          |
| Harness  | OpenCode. It names each new artifact (`art_…`), and Ren keeps that id. |

## 3. Ownership

- Core (`Artifacts.Service`) owns the artifact, its files and idempotency.
  Callers never branch on the provider.
- `ArtifactProvider.Service` runs a version. It gets the artifact id, the operation
  ID, the entry and the files, and returns an opaque reference and a URL.
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

| Operation | Input                                                 | Result                                      |
| --------- | ----------------------------------------------------- | ------------------------------------------- |
| `publish` | Artifact, operation, entry, files, previous reference | Reference and URL, after the version serves |
| `remove`  | Reference                                             | Done; a missing deployment is removed       |

Rules:

1. `publish` returns only when the requested version answers requests.
2. If the new version fails to start, the previous version keeps serving.
3. The URL stays the same across updates of one artifact.
4. Application data survives code updates (`--persist-to` in the workerd layer).
5. `remove` is repeatable.

## 6. Domain rules (`@ren/core/artifacts`)

Ren keeps one row per artifact and the published files as one `.tar.gz` in the
drive bucket, at `<org>/artifacts/<artifact>/<operation>.tar.gz`. It keeps no
version history.

Publish:

1. An id in another space is a `Conflict`. The operation ID of the last publish
   returns the artifact as it is.
2. Upload the archive, then call `provider.publish`.
3. On success, save the artifact (created on the first publish) and delete the
   previous archive. On failure, delete the new archive; the previous version
   keeps serving and stays readable.

Two publishes of one artifact at the same time are not guarded yet.

Remove calls `provider.remove`, deletes the archive, then deletes the artifact.
Deleting a chat or a brain does not remove its artifacts.

## 7. Host API and OpenCode

`RenHostApi` group `artifacts`, keyed by the artifact id:

| Endpoint                        | Does                                             |
| ------------------------------- | ------------------------------------------------ |
| `PUT /host/artifacts/:id`       | Publish. Creates the artifact on the first call. |
| `GET /host/artifacts/:id/files` | The files of the version that serves             |
| `DELETE /host/artifacts/:id`    | Remove                                           |

The plugin registers provider `ren` with `ctx.experimental.artifact.transform`,
makes it the default, and turns on OpenCode's `experimental.artifacts` flag. It
sends one operation ID per tool call and retries a lost response with the same ID.

Later, with the first screen that needs them: version history, a status read
(whether the URL serves), the chat that made an artifact, and a public API.

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
dispatch route before `publish` returns. Needs `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, the namespace, and the artifacts domain.

Done when: switching the layer at the composition root changes no caller and
the Phase 2 applications pass.

### Phase 4 — user-supplied providers

A provider registry, configuration, credential validation, and selection per
artifact. Provider migration is a separate operation.
