# @ren/cell

A session host: one Durable Object per session, on celld or Cloudflare. Serves `BrainApi` to Ren; calls Ren's `RenHostApi`.

`SessionCell` delegates requests and alarms to Effect services. The internal Brain API is implemented by the OpenCode adapter. Client tokens reach only the Chat API (`/chat/*`, `src/chat.ts`), which the adapter serves by translating OpenCode (`src/harness/opencode/chat.ts`, `translate.ts`); every other route needs a server token.

## Lifecycle

`Harness.Service` owns one leased OpenCode instance. Concurrent acquisitions share the same open. A request holds its lease until its response body ends or the client disconnects. Reconciliation closes the host only when every session is idle, no request holds it, and no request arrived during that reconciliation.

The alarm is persisted before waiting for running turns. A wait lasts at most the configured budget or the remaining question-park time. Interrupting an alarm interrupts its wait before releasing the host lease. A failed host disposal fails waiting and future acquisitions rather than opening another instance alongside an incompletely disposed one.

Start, send and API key changes share a semaphore. Model turns continue independently. An expiring API key replaces the stored one only when it expires later.

## Models

`PUT /ren/models` takes a `Models.Access`: endpoints, each with a protocol, a base URL, an API key and its models. The cell stores it in Durable Object storage, so it survives a restart. If OpenCode is open, its endpoints and API keys apply at once; otherwise the next open applies them. Each endpoint becomes an OpenCode provider with the endpoint's id, and each model's efforts become its OpenCode variants. `start` and `send` answer `ModelsNotConfiguredError` (409) until access is stored, and while a stored key has expired; `BrainHost` then grants it and retries once. `DELETE /ren/models` removes the access and Ren's API keys; `BrainHost.revokeModels` calls it and revokes the keys at their source even when the cell cannot be reached.

Access comes with a host token. When OpenCode finds an API key within five minutes of expiring, the cell posts the token to `${REN_URL}/host/models/refresh` and stores the fresh access and token it gets back, so a long turn or a re-sent message never runs on an expired key. Concurrent refreshes share one request. Without `REN_URL`, an expiring key is used until it expires. A model's variants are exactly its `efforts` from Ren's catalog: OpenCode adds none of its own, so every harness and Ren's new-chat picker show the same list.

`app.version` identifies **Ren's cell package**, derived from this package's `package.json`. OpenCode dependency versions are pinned in the workspace catalog.

## Sync

With `REN_URL`, each alarm first uploads the sessions that changed in the OpenCode tables to Ren, then reconciles. It reads `ctx.storage.sql` directly and never opens OpenCode for this. A step that is not drained sets the next alarm at 250 ms, or when the five-minute limit for a busy session ends. A step that fails, or that has a failed upload, backs off from 1 s to 5 min with jitter. The alarm stays set until sync is drained, also after reconcile closed OpenCode. `POST /ren/sync` (`BrainHost.flush`) runs steps for up to 20 s and answers `drained`. Without `REN_URL` the alarm does not sync, and `/ren/sync` answers `drained: false`.

`start` restores a session that the cell does not have from Ren's copy first. When Ren does not answer, `start` answers `SyncUnavailableError` (503) and makes no session, because an empty session would replace Ren's copy at the next sync; `BrainHost` retries it and then fails with `BrainUnavailable`.

Sync uses the host token, and renews it as model refresh does. Each call from Ren carries a fresh one in `ren-host-token`; the cell keeps the token from that header only when it does not expire earlier than the stored one.

## Starting with a message

`BrainHost.start` and `POST /ren/sessions` accept an optional `initialMessage`:

```json
{
  "sessionId": "ses_example",
  "harness": "opencode",
  "instructions": { "team": "Help the Ren team" },
  "initialMessage": {
    "messageId": "msg_example",
    "prompt": { "text": "Summarize the work we should do next" },
    "sender": { "userId": "user_1" }
  }
}
```

The message is submitted after applying the session configuration and instructions, using OpenCode’s default delivery. Start returns its existing `Started` response once the message is accepted, before the turn finishes. Reuse the same message ID on retries: an existing session with a missing message receives it, while an already accepted message is not submitted again. Initial files have the same limits as files in `send`.

## Environments

The production cell has `EnvironmentConnections` whenever `REN_URL` is set. It asks Ren for a session's access through the Ren Host API (`environments.access`, with the host token) at the first file or shell call; `start`, a wake and a continue contact neither Ren nor an environment. The cell keeps the answer in memory only: the binding is in Ren's database, in `session_environment`.

`start` takes a `directory` from Ren only for a new session, which then works in that directory in a `ren` workspace. A later `start` keeps it; a `directory` for a session that started without one answers "not supported yet". Ren refuses a change of environment before it calls the cell. A session without an environment has no read, write, edit, patch, glob, grep or shell; its other tools stay, and the `ren.environment` instruction tells the model why. When the session goes idle (OpenCode's `session.idle` for the session that owns the workspace), the Ren plugin calls `EnvironmentConnections.release`, which calls the Ren Host API's `environments.release`. A tool error names its cause (no access, Ren does not answer, the environment does not answer, token refused, not compatible) through the public `execute.after` hook.

A host with environments replaces OpenCode's `Shell` service with Ren's (`shell.ts`, `RenShell`), because OpenCode's writes every command's full output to the host's data folder, which in workerd is the isolate's memory. Ren's runs each command on the session's environment and has the executor write the full output to OpenCode's path there (`/tmp/opencode/data/shell/<project>/sh_<id>.out`), the path the model is told. It reads the output through a window: the executor sends only the last `max_bytes` (50 KB by default) at most every 250 ms, and counts the bytes and lines it left out, so the model's "showing lines X-Y of Z" stays exact and the cell's memory does not grow with the output. A location without an environment, such as a client's `shell.create`, gets a tool error, and nothing runs in the cell. It publishes OpenCode's shell events (`shell.created`, `shell.exited`, `shell.deleted`) as OpenCode's own Shell does.

The cell renews its host token with `host.refresh` in its last five minutes. A missing or expiring host token makes `start` and `send` answer `ModelsNotConfiguredError`, so Ren configures the brain again with a fresh one.

## Limits

- The shared Brain contract caps decoded files at 10 MB per file and 10 MB in total per message. Invalid payloads receive 400 before acquiring the harness.
- Core's `BRAIN_MAX_FILE_SIZE` can impose a lower per-file limit and rejects before making a host request.
- The worker caps every request body at 16 MB and returns 413 before forwarding it to a Durable Object. It counts streamed bytes as well as checking Content-Length.

## Tests

Run from this package:

```sh
bun run test
bun run test:cloudflare
bun typecheck
```

- `brain-api.test.ts`: `HttpApiTest.groups` with the real Brain handlers, OpenCode adapter, in-memory SQLite and a loopback model fixture. No cell process is needed.
- `alarm.test.ts`: the actual `Cell.alarm` under `TestClock`, first with scripted snapshots, then with the in-process OpenCode harness.
- `remote-tools.test.ts`: the in-process OpenCode harness with tools on real executors.
- `host-access.test.ts`: `HostAccess`, the cell's Ren Host API `EnvironmentAccess`, against a fake Ren (`test/lib/ren.ts`).
- `workspace-driver.test.ts`: the OpenCode `ren` driver's file and error mapping.
- `lease.test.ts`, `reconcile.test.ts`, `credentials.test.ts`, `model-refresh.test.ts`, `sync.test.ts`: Ren's ownership, decisions and transformations.
- `cell.test.ts`: a smoke set of authentication, routing, body limits, streams and the idle close against celld; the same suite runs under Wrangler.
- `crash.test.ts`: durable recovery against celld killed at the critical lifecycle boundaries.
- `environment-lifecycle-cell.test.ts`: the production Worker with a fake Ren, across workerd sleep, crash and restart; it runs only under Wrangler.

Integration processes are acquired and released by scoped layers.
