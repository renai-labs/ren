# @ren/cell

One session host per Durable Object, deployed to celld or Cloudflare. `SessionCell` delegates requests and alarms to Effect services. The internal Brain API is implemented by the OpenCode adapter; client tokens also reach the permitted OpenCode routes.

## Lifecycle

`Harness.Service` owns one leased OpenCode instance. Concurrent acquisitions share the same open. A request holds its lease until its response body ends or the client disconnects. Reconciliation closes the host only when every session is idle, no request holds it, and no request arrived during that reconciliation.

The alarm is persisted before waiting for running turns. A wait lasts at most the configured budget or the remaining question-park time. Interrupting an alarm interrupts its wait before releasing the host lease. A failed host disposal fails waiting and future acquisitions rather than opening another instance alongside an incompletely disposed one.

Start, send and API key changes share a semaphore. Model turns continue independently. An expiring API key replaces the stored one only when it expires later.

## Models

`PUT /ren/models` takes a `Models.Access`: endpoints, each with a protocol, a base URL, an API key and its models. The cell stores it in Durable Object storage, so it survives a restart. If OpenCode is open, its endpoints and API keys apply at once; otherwise the next open applies them. Each endpoint becomes an OpenCode provider with the endpoint's id, and each model's efforts become its OpenCode variants. `start` and `send` answer `ModelsNotConfiguredError` (409) until access is stored, and while a stored key has expired; `BrainHost` then grants it and retries once. `DELETE /ren/models` removes the access and Ren's API keys; `BrainHost.revokeModels` calls it and revokes the keys at their source even when the cell cannot be reached.

Access comes with a host token. When OpenCode finds an API key within five minutes of expiring, the cell posts the token to `${REN_URL}/brain/models/refresh` and stores the fresh access and token it gets back, so a long turn or a re-sent message never runs on an expired key. Concurrent refreshes share one request. Without `REN_URL`, an expiring key is used until it expires. A model OpenCode already knows keeps its own reasoning variants; `efforts` adds to them.

`app.version` identifies **Ren's cell package**, derived from this package's `package.json`. OpenCode dependency versions are pinned in the workspace catalog.

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

When the cell has `Environments`, every session gets a `ren` workspace, and `start` sets which environment its file and shell tools run on. `environments: [location]` attaches or moves the session, `environments: []` detaches it, and no `environments` keeps the current one. The cell checks that the directory exists on the environment, then stores the binding in Durable Object storage under `ren:environment-binding:`. The next tool call uses the new binding; the conversation stays. A change waits up to 10 seconds for a running turn to end, and then answers `BrainRejectedError`. The session's directory stays the one it started with: paths under it map onto the environment's directory, and the `ren.environment` instruction tells the model where its tools run. A session without an environment has no file or shell tools.

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
- `alarm.test.ts`: the actual `Cell.alarm` under `TestClock`, scripted snapshots and the real lease implementation.
- `lease.test.ts`, `reconcile.test.ts`, `credentials.test.ts`, `instruction-entries.test.ts`: Ren's ownership, decisions and transformations.
- `cell.test.ts`: authentication, routing, body limits, streams and lifecycle against celld; the same suite runs under Wrangler.
- `crash.test.ts`: durable recovery against celld killed at the critical lifecycle boundaries.

Integration processes are acquired and released by scoped layers. Cloudflare deployment measurements and the next host-contract steps remain in [`brain-host-roadmap.md`](../../specs/brain-host-roadmap.md).
