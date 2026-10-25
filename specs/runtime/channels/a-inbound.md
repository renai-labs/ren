# Piece A: inbound core

Status: spec written. Decisions: CH4, CH5, CH6, CH7, CH8, CH9, CH10 (README §4).

## Goal

A provider sends an event to Ren. Ren checks it, stores one run for it, and answers 200. The run puts one message into the session of the event's thread. A repeated delivery of the same event gives one message. Two first events on a new thread give one session.

Not in this piece:

- Which space, agent and Ren user an event maps to: `ChannelRoute`, pieces C and D.
- The text of the prompt (the envelope) and the reply path: piece B.
- `interactive`, the first sign of life (Slack 👀, Linear `thought`) and the text of notices: piece E.
- The install record that `channel_thread.install` names: piece D.
- Provider parsing (Slack, Linear, GitHub): pieces F, G, H.

## Model

```
 ┌──────────────┐  POST /channels/:provider   ┌───────────────────────┐  DurableRunner.ensure(ChannelEvent)     ┌───────────────────────┐
 │              │  raw body + signature       │                       │  key: <provider>:<install>:<eventId>    │                       │
 │  provider    │ ──────────────────────────▶ │  Channels.receive     │ ──────────────────────────────────────▶ │  ChannelEvent run     │
 │              │                             │  1 verify             │  payload: { event, messageId,           │  route, files,        │
 │              │ ◀────────────────────────── │  2 parse              │             sessionId }                 │  claim thread,        │
 └──────────────┘  200 after the run is       │  3 ensure the run     │  stored in Postgres before the 200      │  create or send       │
                   stored                     └───────────────────────┘                                         └───────────┬───────────┘
                                                                                                                            │
                                                                     SessionRunner.create / send { messageId, delivery: steer }│
                                                                                                                            ▼
                                                                                                                         brain
```

A thread maps to one session. One session can hold many threads (piece B adds threads that the agent posts).

```
 channel_thread (slack, ins_1, C07:1712.33)  ──▶  agent_session ses_A
 channel_thread (slack, ins_1, C07:1713.90)  ──▶  agent_session ses_A
 channel_thread (github, ins_2, 8812:pr:41)  ──▶  agent_session ses_B
```

## Contract changes

### Schema (`@ren/schema/channel`)

Add next to `Declaration` and `Target` (`schema/src/channel.ts:11`, `:30`):

```ts
Provider = Schema.Literals(["slack", "linear", "github"])

FileRef = { url: string, name: string, mime: string, size?: number }   // bytes are read in the run

Event = {
  provider: Provider,
  eventId: NonEmptyString,                    // the provider's id of this delivery
  install: NonEmptyString,                    // the provider's workspace id: Slack team, Linear organization, GitHub installation
  place: { id: NonEmptyString, kind: "channel" | "dm" | "project" | "repository", name?: string },
  thread: { id: NonEmptyString, url?: string },
  sender: { accountId: NonEmptyString, name?: string, handle?: string },
  text: string,
  files: ReadonlyArray<FileRef>,
}

Parsed =
  | { _tag: "Handshake", body: Schema.Json }    // Slack url_verification, GitHub ping
  | { _tag: "Ignore", reason: string }          // a bot's own message, an unhandled event type
  | { _tag: "Event", event: Event }
  | { _tag: "Signal", signal: … }                // a GitHub merge (piece I); starts no turn
  | { _tag: "Stop", install, thread }            // a Linear stop request (piece G); interrupts the thread's turn
```

### Database (`db`)

Table `channel_thread`:

| Column            | Type        | Notes                                                 |
| ----------------- | ----------- | ----------------------------------------------------- |
| `id`              | text        | prefix `cth`                                          |
| `organization_id` | text        | from the route                                        |
| `provider`        | text        | `Channel.Provider`                                    |
| `install`         | text        | Ren's install record; its shape is decided in piece D |
| `thread`          | text        | `Event.thread.id`                                     |
| `session_id`      | text        | references `agent_session.id`                         |
| `url`             | text, null  | `Event.thread.url`; set once                          |
| `created_at`      | timestamptz |                                                       |
| `updated_at`      | timestamptz |                                                       |

Unique index `(provider, install, thread)`. Index `(session_id)`. A generated migration only (E13).

### Server

`POST /channels/:provider`, a route outside `HttpApi`, like `server/src/oauth-routes.ts:17`. It reads the raw body as text, with the server's body limit, and calls `Channels.receive`. It has no login check: `verify` is the authentication.

## Services and layers

| Service                       | Package | Does                                                                                                          | Layers                                                                   | Chosen by            |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| `ChannelProvider` (interface) | `core`  | One item per provider: `id`, `verify`, `parse`, `fetchFile`. Piece B adds `send`; piece E adds `progress`.    | `slack`, `linear`, `github` in `core/src/channel-provider/`; a test item | —                    |
| `ChannelProvider.Registry`    | `core`  | `providers`, `get(id)`. Same shape as `EnvironmentProvider.Registry` (`core/src/environment-provider.ts:97`). | one, from the configured items                                           | `server/src/main.ts` |
| `Channels.Service`            | `core`  | `receive(provider, request)`; registers and runs `ChannelEvent`.                                              | one                                                                      | `server/src/main.ts` |
| `ChannelRoute.Service`        | `core`  | `resolve(event)` → `Route` or `Refused`. Pieces C and D specify it.                                           | one                                                                      | `server/src/main.ts` |

```ts
interface ChannelProvider {
  readonly id: Channel.Provider
  readonly verify: (request: Request) => Effect<void, ChannelProvider.Unauthorized>
  readonly parse: (request: Request) => Effect<Channel.Parsed, ChannelProvider.Malformed>
  readonly fetchFile: (install: string, file: Channel.FileRef) => Effect<Uint8Array, ChannelProvider.FileUnavailable>
}
type Request = { readonly headers: Headers; readonly body: string } // the raw body text; the signature covers it

interface ChannelRoute {
  readonly resolve: (event: Channel.Event) => Effect<Route, ChannelRoute.Refused>
}
type Route = { organizationId; spaceId; agentId?: Agent.ID; senderUserId: Auth.UserID }
```

Rules:

1. `verify` runs before `parse` and before any lookup. It checks the exact raw body text (channels ledger rows 3, 4).
2. `parse` makes no call that can take more than a few milliseconds. Network reads (files, thread context, a Linear project) run in the run, never before the 200.
3. A provider never builds a thread key. The core builds it from provider, install and thread (CH6).
4. `Channels` never names a provider. It asks the registry.

## HTTP results

| Case                       | Status | Body                 |
| -------------------------- | ------ | -------------------- |
| No provider with that id   | 404    | —                    |
| `verify` fails             | 401    | —                    |
| `parse` fails              | 400    | —                    |
| `Handshake`                | 200    | the handshake's body |
| `Ignore`                   | 200    | — (reason logged)    |
| `Event`, `ensure` succeeds | 200    | —                    |
| `Event`, `ensure` fails    | 500    | — (provider retries) |

A refusal for a business reason (unmapped place, refused sender) happens in the run, after the 200, so the provider does not retry it (channels ledger row 5).

## The `ChannelEvent` run

`DurableRunner.make("ChannelEvent", …)`. Key: `<provider>:<install>:<eventId>`. Payload: `{ event, messageId, sessionId }`. `receive` creates `messageId` and `sessionId` once, before `ensure`. A repeated delivery has the same key, so it joins the same run and its new ids are not used.

| Step | Does                                                                                                                                                                                                              | On failure                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | `progress(received)` (piece E rule 3), then the provider's optional `locate(install, event)` to fill the place (Linear, piece G).                                                                                 | A failed `received` is logged.                                                                                                                                     |
| 1    | `ChannelRoute.resolve(event)`                                                                                                                                                                                     | `Refused` → notice to the place (piece C text), stop                                                                                                               |
| 2    | `fetchFile` for each reference, 4 at a time. Encode each as a data URL (`Session.File`).                                                                                                                          | A failed file is dropped. A file that would make the total exceed 10 MB is skipped (CH10). The text gets one note line per dropped or skipped file, with its name. |
| 3    | Insert `channel_thread` with `session_id = payload.sessionId`, `on conflict do nothing`. Read the row.                                                                                                            | —                                                                                                                                                                  |
| 4    | The row's session is archived or gone: `update … set session_id = payload.sessionId where session_id = <old>`. Read the row again (CH9).                                                                          | —                                                                                                                                                                  |
| 5    | The row's session is `payload.sessionId`: `SessionRunner.create(owner, { sessionId, harness: "opencode", initialMessage: { messageId, prompt, sender } }, { agentId })`. `owner.createdBy` is the route's sender. | `AlreadyExists` (a retry after a create) → step 6                                                                                                                  |
| 6    | Otherwise: `SessionRunner.send({ sessionId, messageId, prompt, sender, delivery: "steer" })` (CH7)                                                                                                                | `BrainUnavailable` → retry with `DurableRunner.supervise` (CH8). Brain `failed`, or the sender is no longer a member of the space → notice, stop.                  |

The brain skips a message id that it already has (`cell/src/harness/opencode/chat.ts:61`), so a retry of step 5 or 6 delivers once.

## Lifecycle states

| State                | What happens                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Brain asleep         | `SessionRunner.send` wakes it through `BrainHost`.                                                                       |
| Brain waking         | `BrainUnavailable`. The run retries with the same message id.                                                            |
| Session mid-turn     | The message steers the running turn (CH7).                                                                               |
| Brain `failed` (E81) | The run stops and sends one notice.                                                                                      |
| Brain restarting     | `SessionNotStartedError` → `SessionRunner.send` starts the session with this message (`core/src/session/runner.ts:126`). |
| Ren restarts mid-run | The cluster workflow engine resumes the run from Postgres (`SingleRunner` with `SqlMessageStorage`).                     |
| Ren down             | No 200. The provider retries on its own schedule (pieces F, G, H list each schedule).                                    |

## Edge cases

| #   | Case                                                       | Rule                                                                             | Source                                          |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | The process dies after the 200 and before the work starts. | The 200 comes after the run is stored (CH5).                                     | slack ledger row 6                              |
| 2   | A provider delivers one event twice.                       | Same run key; one message.                                                       | channels ledger rows 10, 11                     |
| 3   | Two first events on a new thread at the same time.         | One thread row wins; both messages go to its session (CH6).                      | `temporal/webhook-trigger/activities.ts:57-108` |
| 4   | A retry of the run after `SessionRunner.create` succeeded. | `AlreadyExists` → `send` with the same message id; the brain skips it.           | —                                               |
| 5   | A long delivery retry.                                     | Repeats only an idempotent delivery; stops on `failed` or lost membership (CH8). | `73f92bce2` (926 attempts)                      |
| 6   | A thread whose session was archived.                       | New session; the row moves (CH9).                                                | channels ledger row 38                          |
| 7   | A file that cannot be read.                                | Dropped with a note; the message goes on.                                        | channels ledger row 63                          |
| 8   | Files over 10 MB in total.                                 | Skipped with a note (CH10).                                                      | slack ledger row 50                             |
| 9   | A provider that needs an answer in 3 s (Slack).            | `parse` makes no network call; `ensure` is one Postgres write.                   | channels ledger row 7                           |

## Tests

Core tests with real Postgres and a test `ChannelProvider` item. No mocks of Ren services, no real-time waits.

1. A bad signature gives 401 and stores no run.
2. An unknown provider gives 404.
3. A signed body that does not parse gives 400.
4. `Ignore` gives 200 and stores no run.
5. `Handshake` gives 200 with its body.
6. The same event delivered twice gives one run, and the brain sees one message id.
7. Two first events on a new thread at the same time give one session that holds both messages.
8. A thread whose session is archived gets a new session; the row moves; the old session does not change.
9. `BrainUnavailable` on the first send: the run retries and the message arrives once, with the same id.
10. A `failed` brain: the run stops and sends one notice.
11. `ensure` fails: the route answers 500.
12. One file fails to read: the message arrives without it, with a note.
13. Files over 10 MB in total: the extra files are skipped, with a note.
14. A message to a session mid-turn uses `delivery: "steer"`.
