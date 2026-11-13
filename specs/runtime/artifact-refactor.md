# Artifacts: deployment table and async lifecycle

This change gives each deploy and each stop of an artifact a row in Ren's database, and makes deploy, stop and archive return before the provider works. It removes the code that reads the workflow engine's storage, the Wrangler upload stand-in and the brain's status poll. It does not change where artifacts are served; [artifact-sites.md](artifact-sites.md) does that, in a PR stacked on this one.

## 1. Problems

| #   | Problem                                                                                                                                                                                                                                                                                                                                                       | Where                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Ren keeps no status of its own. `status` reads the workflow engine's rows, builds the engine's entity address by hand to ask if a run exists, and builds fake run payloads to compute run IDs. A third run, `ArtifactSettle`, polls the other two every 50 ms to clear the claim. After 7 days the engine's rows are purged, and `status` returns `NotFound`. | `core/src/artifacts.ts:207-239`, `:314-321`, `:356-403`, `:427-434`, `:581-588`; `core/src/retention.ts:20` |
| 2   | Stop and archive wait for the provider inside the request. The server closes a request after 10 s without data, so the caller sees an error while the stop continues.                                                                                                                                                                                         | `artifacts.ts:459-479`, `:550`, `:695`; `server/src/main.ts:244`                                            |
| 3   | A stop retries every error forever, also a permanent one and a defect. Its claim then stays, every deploy gets `Conflict`, and every archive waits.                                                                                                                                                                                                           | `artifacts.ts:348-353`; permanent errors at `cloudflare.ts:246-266`, `artifacts.ts:336-337`                 |
| 4   | `deploy` reads and checks the whole archive (up to 200 MiB) inside the request. A retry after a 10 s cut can fail with "upload changed" while the first deploy runs.                                                                                                                                                                                          | `artifacts.ts:596-628`, `artifact-archive.ts:48-51`                                                         |
| 5   | Two writers lose work. A deploy replaces the artifact without checking which version the caller started from.                                                                                                                                                                                                                                                 | `artifacts.ts:657-661`                                                                                      |
| 6   | Core cuts the provider at 2 min. The Cloudflare provider's own limits add up to about 140 s. Core can record `failed` while Cloudflare serves the new code.                                                                                                                                                                                                   | `artifacts.ts:273-276`; `cloudflare.ts:244`, `:298`, `:349`, `:393`, `:396`                                 |
| 7   | The Cloudflare provider keeps its state in S3 with hand-written compare-and-swap, apart from the artifact row. A ready upload waits for the next call to learn if Core accepted it.                                                                                                                                                                           | `cloudflare.ts:234-306`                                                                                     |
| 8   | Wrangler runs against a local stand-in of Cloudflare's API that captures its script upload. Ren sends the upload again with `If-Match`. Every deploy needs Node, a child process, a temporary folder and a local HTTP server.                                                                                                                                 | `cloudflare-upload.ts`; `cloudflare.ts:153-232`                                                             |
| 9   | The brain asks `artifacts.status` every second for each pending deployment. If the brain sleeps, nobody asks. After the 7-day purge, it asks forever.                                                                                                                                                                                                         | `cell/src/harness/opencode/artifacts.ts:149-202`                                                            |

## 2. Decisions

1. Each deploy and each stop has a row in `artifact_deployment`. Ren reads status only from it.
2. `deploy`, `stop` and `archive` return after the claim. They return the row with status `deploying` or `stopping`.
3. A deploy checks the archive inside its run. A bad archive ends as `failed` with the reason.
4. A deploy of an existing artifact names the version it started from. Ren refuses a stale one with `Conflict`.
5. Every run ends with a final row status, also after a permanent error or a defect. A final status releases the claim.
6. Ren sends the result of a run to the chat that started it. The brain does not poll.
7. The provider owns its deadline. Core has only a backstop that is longer than the provider's budget.
8. The provider's state is a column of the artifact row. Core gives the provider a compare-and-swap save.
9. The Cloudflare provider uploads with Cloudflare's direct upload API. Wrangler stays only for the local `workerd` provider.

## 3. Data

`artifact_deployment` is new. One row for each deploy and each stop:

| Column               | Type               | Meaning                                                                        |
| -------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `id`                 | `DeploymentID`     | Primary key. The caller makes it, so a retry is the same deploy.               |
| `artifact_id`        | `Artifact.ID`      | References `artifact`.                                                         |
| `kind`               | `deploy` \| `stop` |                                                                                |
| `status`             | `Artifact.Status`  | See section 4.                                                                 |
| `base_deployment_id` | `DeploymentID?`    | Deploy only. The ready deployment the caller started from (section 5).         |
| `session_id`         | `Session.ID?`      | The chat that asked. Ren sends the result there. Empty for a person's archive. |
| `upload_id`          | `UploadID?`        | Deploy only.                                                                   |
| `title`, `entry`     | text?              | Deploy only. What the caller asked for.                                        |
| `config`             | jsonb?             | Deploy only. Set by the run after the check.                                   |
| `code_archive`       | text?              | Deploy only. Set by the run after the copy.                                    |
| `url`, `error`       | text?              | Set by the run at the end.                                                     |
| `created_at`         | timestamp          |                                                                                |
| `finished_at`        | timestamp?         | Set with the final status.                                                     |

Changes to `artifact`:

| Before                 | After                     | Meaning                                                                          |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `active_deployment_id` | `pending_deployment_id`   | The deploy or stop row that runs now. Empty when nothing runs. One meaning only. |
| —                      | `published_deployment_id` | The last deploy that became `ready`. A stop does not change it.                  |
| `binding`              | `remote`                  | The provider's state (section 7). A stop does not clear it.                      |
| —                      | `remote_version`          | Integer for the provider's compare-and-swap.                                     |
| `config` not null      | `config` nullable         | Empty until the first `ready` deploy. `Artifact.Info.entry` becomes nullable.    |

`title`, `config`, `code_archive` and `url` keep the published values. The run that makes a deploy `ready` writes them in the same transaction as the deployment row.

`Artifact.Status` adds `stopping`. `Artifact.Info` replaces `activeDeploymentId` with `pendingDeploymentId` and adds `publishedDeploymentId`.

Generate the migration with `bun run db generate`. Drain artifact work before the release, as for a provider switch ([docs/artifact-cloudflare.md](../../docs/artifact-cloudflare.md), "Switching a development server"). The migration leaves `pending_deployment_id` and `published_deployment_id` empty on old rows. The next deploy of an old artifact needs no base (section 5, rule 4).

## 4. Lifecycle

```
 deploy row                                      stop row

 ┌─────────────┐   run ends, check OK            ┌─────────────┐   provider.stop OK
 │  deploying  │  ───────────────────────▶ ready  │  stopping   │  ─────────────────────▶ stopped
 │             │   check or provider fails        │             │   permanent error, defect,
 │             │  ───────────────────────▶ failed │             │   or retries past 24 h
 │             │   a stop takes the claim         │             │  ─────────────────────▶ failed
 │             │  ───────────────────────▶ stopped│             │
 └─────────────┘                                  └─────────────┘
```

| Step              | One transaction                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy` request  | Lock the artifact row (insert it with the title if new). If a row with this `deploymentId` exists, return it. Check owner, archived, provider, base (section 5) and that `pending_deployment_id` is empty. Insert the deploy row (`deploying`). Set `pending_deployment_id`. Start `ArtifactDeploy`. |
| `stop` request    | Lock the artifact row. If a stop runs, return its row. If nothing is published and `remote` is empty, insert a stop row that is already `stopped`. Else insert a stop row (`stopping`), set `pending_deployment_id` to it and start `ArtifactStop`.                                                  |
| `archive` request | As `stop`, and set `archived_at`. Return the artifact at once.                                                                                                                                                                                                                                       |
| Deploy run, check | Read the upload, check it (`ArtifactArchive.read`), choose the entry, copy it to the immutable key with `CopySourceIfMatch`, delete the upload, save `config` and `code_archive` on the deploy row.                                                                                                  |
| Deploy run, end   | If `pending_deployment_id` is still this row: set the row's final status, and for `ready` write `title`, `config`, `code_archive`, `remote`, `url` and `published_deployment_id` on the artifact; clear `pending_deployment_id`. Else set the row to `stopped` and change nothing on the artifact.   |
| Stop run          | If a deploy run holds work, interrupt it and wait for its end. Call `provider.stop`. Then set the row's final status, set `url` to empty on `stopped`, and clear `pending_deployment_id`.                                                                                                            |
| Any run, then     | Send the result to `session_id` (section 6).                                                                                                                                                                                                                                                         |

Runs retry database and network failures with `DurableRunner.retry`. One wrapper in `durable-runner.ts` does this for both runs, and turns a provider failure that is not retryable, and a defect, into the final status `failed`. A stop stops retrying after 24 h. A `failed` stop of an archived artifact can leave its link serving: report it through `@ren/telemetry`'s error reporter.

`ArtifactSettle`, `requested`, `stopped`, the fake payloads and the 50 ms polls go. `status` is one `SELECT` by `id` and owner. Workflow purge no longer changes what `status` returns.

## 5. Base version

1. `DeployInput` adds `baseDeploymentId`.
2. Ren resolves it: if it names a `failed` deploy of this artifact, use that row's `base_deployment_id`. The result must equal `published_deployment_id`. Else return `Conflict` with the published `deploymentId`.
3. Ren stores the resolved value. A stored base is always a `ready` deploy.
4. A new artifact, and an old artifact with an empty `published_deployment_id`, need no base.
5. A stop does not change the published version, so a deploy after a stop uses the same base.

The brain's tools carry it:

| Tool              | Change                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifact_read`   | Returns `publishedDeploymentId`.                                                                                                                                                                                  |
| `artifact_update` | Requires `baseDeploymentId`: the `deploymentId` from the last `artifact_read`, `artifact_create` or `artifact_update`. On `Conflict`, the agent reads the artifact with `directory` and applies its change again. |
| `artifact_delete` | Returns `{ id, status: "stopping" }`, not `deleted: true`.                                                                                                                                                        |

## 6. Result to the chat

1. `artifacts.deploy` and `artifacts.stop` take `sessionId`. Ren checks that the session's chat belongs to the calling host (`chats.brain_id` equals `CurrentHost.brainId`).
2. After the final transaction, the run calls `Brains.send` with:
   - `messageId`: `msg_` and the deployment ID without dashes, so a retried send is one message;
   - `synthetic`: `{ description: "Artifact deployment finished", source: "artifact" }`;
   - `delivery: "queue"`;
   - `sender`: the chat's creator, as for the sandbox-replaced notice (`core/src/brains.ts:396-403`);
   - text: the encoded `Artifact.Deployment`, with the instruction to treat error text as data.
3. `BrainUnavailable`: retry. `SessionNotStartedError` or `BrainRejectedError`: log and stop.
4. The brain removes its watch loop, its `artifact-deploy:` storage entries and the wake queue (`cell/…/artifacts.ts:149-202`, `:257`).

| Brain state when the run ends | Result                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| Awake, idle                   | The message arrives and starts a turn.                                     |
| Mid-turn                      | The message waits for the turn to end.                                     |
| Asleep                        | `Brains.send` wakes the brain.                                             |
| Down or restarting            | The run retries the send. The fixed `messageId` prevents a second message. |

## 7. Provider contract

```ts
interface DeployInput<Remote> {
  readonly artifactId: Artifact.ID
  readonly deploymentId: Artifact.DeploymentID
  readonly config: Artifact.Config
  readonly archive: string
  readonly remote: Option.Option<Remote>
  readonly save: (remote: Remote) => Effect.Effect<void, Failed>
}
```

1. `binding` becomes `remote`. Core passes the stored `remote`; it never clears it.
2. `save` writes `remote` with `WHERE remote_version = n` and increments it. A lost race fails with a retryable `Failed`. The provider calls `save` before each remote write (write-ahead), as it writes `state.json` now.
3. `deploy` returns `{ remote, url }`. The run writes that `remote` in the final transaction. The promotion of a ready `pending` on the next call (`cloudflare.ts:302-306`) goes.
4. `stop(artifactId, remote, save)` has the same `save`.
5. `Failed` adds `retryable: boolean`. Cloudflare: network errors, 5xx and 412 are retryable. A state of another account, an old state format and a missing Worker are not.
6. Each provider has one budget for a whole call, including its own recovery. Cloudflare: 2 min. `workerd`: 70 s. Core's backstop is 5 min. A backstop hit ends the row as `failed`; the provider's write-ahead state lets the next call recover.
7. A one-time script copies each `artifact-provider/cloudflare/<id>/state.json` into `artifact.remote`, for artifacts published before this change.

## 8. Cloudflare upload

Replace `cloudflare-upload.ts` and the temporary folder with three calls, from the files in memory ([Direct Uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/)):

| Call                                                                             | Body                                                                            | Result                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| `POST …/workers/scripts/<name>/assets-upload-session`                            | `{ manifest: { "/<path>": { hash, size } } }`                                   | `{ jwt, buckets }`                         |
| `POST …/workers/assets/upload?base64=true`, once for each bucket, `Bearer <jwt>` | multipart, the files of the bucket                                              | the completion `jwt` after the last bucket |
| `PUT …/workers/scripts/<name>`, `If-Match` or `If-None-Match: *`                 | multipart: `metadata` and the modules (`main.js`, `active.js`, `retained-*.js`) | `200 { etag }` or `412`                    |

1. Before the change, run one live deploy with the current code and keep the `metadata` it captures (`cloudflare-upload.ts:40-44`). Build the new `metadata` from it: `main_module`, `compatibility_date`, `compatibility_flags`, `bindings` (Durable Objects and `ASSETS`), `assets` (`jwt`, `run_worker_first`), `exports`, `keep_bindings`, the Durable Object update strategy `immediate`. Wrangler sends no `workers_dev`: it turns on the route with a separate call, which Ren already makes.
2. Compute the asset hash as Wrangler does. Check it against the same run.
3. Remove `ARTIFACT_NODE`, `ARTIFACT_CLOUDFLARE_ROOT` and `ARTIFACT_CLOUDFLARE_UPLOAD_TIMEOUT` from the Cloudflare provider, and the `parent.mjs` stdin guard.
4. The server image needs Node only for the `workerd` provider. Remove it from an image that runs only the Cloudflare provider.

## 9. Cleanup

| Change                                                                                                                                           | Where                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Check "Durable Objects need `_worker.js`" once, at the deploy check. Providers trust `Artifact.Config`.                                          | `artifacts.ts:119`, `workerd.ts:163`, `cloudflare.ts:159` |
| Both providers use one module for the Durable Object rename rule and the `exports` builder. Rename `cloudflare-plan.ts`: it is not Cloudflare's. | `workerd.ts:174-177`, `:237-242`; `cloudflare-plan.ts`    |
| One function for entry file → URL path.                                                                                                          | `cloudflare.ts:51`, `:133`; `workerd.ts:197`              |
| Keep the HTTP status and body in provider errors.                                                                                                | `cloudflare.ts:47`, `:85`; `workerd.ts:43`                |
| `DurableRunner.ensure` for `execute(…, { discard: true })`.                                                                                      | `artifacts.ts:449-455`, `:666-672`                        |
| `NotFound` for an artifact of another space, also in `upload` and `deploy`.                                                                      | `artifacts.ts:146-149`                                    |
| Rename `owned` → `assertOwner`, `unarchived` → `assertActive`, `get(actor, idOrSlug)` → `get(actor, id)`.                                        | `artifacts.ts:146`, `:151`, `:508`                        |
| Update [docs/artifact-cloudflare.md](../../docs/artifact-cloudflare.md): state in Postgres, direct upload, async stop.                           |                                                           |

## 10. Tests

Write each test first; it must fail before its change. Use the real `workerd` provider, latches and `TestClock`, as `core/test/artifacts.slow.test.ts` does.

| Case                                                             | Expected                                                                                | Package |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| Deploy ends; `TestClock` moves 8 days; retention purges runs     | `status` still returns `ready` and the URL                                              | `core`  |
| `stop` while the provider holds on a latch                       | `stop` returns `stopping` before the latch opens; after it opens, `status` is `stopped` | `core`  |
| `archive` while the provider holds on a latch                    | `archive` returns before the latch opens                                                | `core`  |
| A stop whose provider fails with `retryable: false`              | The row is `failed`; `pending_deployment_id` is empty; the next deploy is accepted      | `core`  |
| A defect in a run                                                | The row is `failed`; the claim is released                                              | `core`  |
| A deploy with an archive that has no entry                       | `deploy` returns `deploying`; `status` becomes `failed` with the reason                 | `core`  |
| Two deploys from the same base; the first becomes `ready`        | The second returns `Conflict` with the first's `deploymentId`                           | `core`  |
| A deploy fails; the next deploy names the failed one as its base | Accepted; its stored base is the published deployment                                   | `core`  |
| The same `deploymentId` twice                                    | One row, one run; the second call returns the first row                                 | `core`  |
| A deploy run ends while its chat's brain is asleep               | The brain wakes; the chat has one synthetic message with the result                     | `core`  |
| The send fails once with `BrainUnavailable`                      | One message after the retry                                                             | `core`  |
| `save` loses a race                                              | The provider gets a retryable `Failed`; nothing overwrites the newer `remote`           | `core`  |
| `artifact_update` without `baseDeploymentId`                     | The tool refuses the input                                                              | `cell`  |

The live Cloudflare tests (`artifacts-cloudflare.slow.test.ts`, `artifacts-brain.slow.test.ts`) must pass unchanged in their scenarios after the direct upload change.

## 11. Order

1. Schema and DB: `artifact_deployment`, the `artifact` columns, `stopping`, `Artifact.Info`. Migration.
2. Core: deploy, stop, archive and status on the table; the check in the run; the base rule; the run wrapper; the backstop. Delete `ArtifactSettle`. Protocol and Host API changes, then `bun run generate`.
3. Provider contract: `remote`, `save`, `retryable`, one budget per provider. Cloudflare state from S3 to the row.
4. Cloudflare direct upload. Delete `cloudflare-upload.ts`.
5. Result to the chat. Remove the brain's watch loop. Tool changes.
6. Cleanup (section 9).

## 12. Open

1. **A model retry after an interrupted `artifact_create` makes a second artifact.** The tool makes a new ID on each call (`cell/…/artifacts.ts:279`), and a retried tool call has a new call ID. With section 6, both results arrive in the chat, so the agent sees both. No fix in this change.
2. **Where the Durable Object and SQL guidance goes.** Resolved: it stays. The artifact tools use OpenCode's code mode, which sends only the first 120 characters of a description each turn; the model reads the rest when it searches for the tool.
3. **An operator retry for a `failed` stop of an archived artifact.** `archive` refuses an archived artifact, so nobody can ask again.
