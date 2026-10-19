# Chat: plan

The plan to build chat in Ren end to end: a member opens a session in the app, chats with it through the cell, and finds it again in the session list (the "done when" of [brain-host-roadmap](../brain-host-roadmap.md) §2). The logic must be the same on web, desktop and a later React Native app, and must not depend on the harness.

The [inventory](inventory/README.md) lists every edge case that OpenCode's client handles, and the Ren-specific cases from ren-v1, with their source files. Each case is ported one at a time and marked done there.

- [1. Decisions](#1-decisions)
- [2. Layers and data flow](#2-layers-and-data-flow)
  - [2.1 Generated clients](#21-generated-clients)
- [3. Schema: OpenCode-shaped, Ren-owned](#3-schema-opencode-shaped-ren-owned)
- [4. Cell: the client protocol](#4-cell-the-client-protocol)
- [5. Ren server: the session group](#5-ren-server-the-session-group)
- [6. `@ren/chat`: the shared runtime](#6-renchat-the-shared-runtime)
- [7. `@ren/ui` and `@ren/app`](#7-renui-and-renapp)
- [8. Lessons from t3code](#8-lessons-from-t3code)
- [9. Build order](#9-build-order)
- [10. Tests](#10-tests)
- [11. Open questions](#11-open-questions)

## 1. Decisions

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| C1  | The brain normalizes. Clients never see a harness API or harness events. Raw OpenCode access stays behind a `debug` scope.                                                                                                                                                                                                                                                        | Old mobile and desktop builds, server consumers (status, notifications, search), security, one adapter per harness. |
| C2  | Normalization is a stateless translation in the cell's harness adapter. No new event store. OpenCode's database in the cell stays the source of truth; Postgres keeps the synced copy.                                                                                                                                                                                            | Avoids t3code's write amplification (§8).                                                                           |
| C3  | While OpenCode is the only harness, Ren's model has OpenCode v2's shapes: messages, content, tool states, inbox, events, permissions and forms.                                                                                                                                                                                                                                   | The OpenCode client logic ports almost unchanged.                                                                   |
| C4  | `@ren/schema` owns a copy of the session-scoped subset of `@opencode/schema`. A contract test in the cell decodes real OpenCode output with Ren's schemas, so an OpenCode upgrade that changes a shape fails CI.                                                                                                                                                                  | The public contract changes only on purpose.                                                                        |
| C5  | The cell passes events through an allowlist, strips internal fields (instructions text, location, project, vcs, lsp, mcp, integration, pty, config) and adds Ren fields (sender, cursor, Ren status).                                                                                                                                                                             | Deny-lists leak new upstream events by default.                                                                     |
| C6  | Every session carries `capabilities` (fork, revert, steer, queue, forms, shell, compact, ...). All true for OpenCode. The UI checks capabilities, never the harness name.                                                                                                                                                                                                         | A second harness hides actions instead of breaking them.                                                            |
| C7  | Clients tolerate the unknown: an unknown event is skipped, an unknown content or tool type renders as a generic row, an unknown request kind renders as a generic prompt. Nothing is dropped silently.                                                                                                                                                                            | Older clients against a newer server. t3code #4795.                                                                 |
| C8  | The app connects to the cell directly: Ren returns `{ url, token, expiresAt }` (`BrainHost.access`), the runtime refreshes the token before it expires.                                                                                                                                                                                                                           | Roadmap §2. No fan-out through the Ren server.                                                                      |
| C9  | Live chat state lives in Effect Atoms (`effect/reactivity`), read in React with `@effect/atom-react`. TanStack Query keeps lists and metadata.                                                                                                                                                                                                                                    | Effect types end to end; per-key fine-grained updates; works in React Native.                                       |
| C10 | A new package, `@ren/chat`, holds everything that is the same on every platform: connection, reducer, outbox, projection, atoms. No DOM and no React in its root entry; React hooks in `@ren/chat/react`.                                                                                                                                                                         | A React Native app reuses it unchanged.                                                                             |
| C11 | Port OpenCode's logic: `client/src/solid/*`, `session-ui/src/timeline/*`, `app/src/session/*`, `app/src/composer/*`. Cross-check with `ren-v1-oc-v2` `transport-v2`. Keep ren-v1 pixel parity for components.                                                                                                                                                                     | OpenCode has found and fixed most edge cases.                                                                       |
| C12 | All edge cases in the inventory are in scope. The first PR ships the vertical slice; the rest follows area by area.                                                                                                                                                                                                                                                               | User decision.                                                                                                      |
| C13 | Reconnect works as in OpenCode: deltas are never persisted or replayed, no `Last-Event-ID`; after `server.connected` the client invalidates its reads and the mounted views read their resources again (SYNC-14, SYNC-52, SYNC-56).                                                                                                                                               | Simple and proven.                                                                                                  |
| C14 | The client's API to a live session is `ChatApi`, a second `HttpApi` in `@ren/protocol` (`src/chat.ts`). It names no host: the brain serves it, whether the brain runs in a cell, a Durable Object or a sandbox. It is not added to `Api`, so the Ren server does not mount it. `cell` depends on `protocol` to serve it. `@ren/client` generates a second set of clients from it. | One contract for server and client; the Ren server's `openapi.json` stays its own.                                  |
| C15 | The transcript is read through the brain; opening a chat wakes it. The sidebar list and session metadata come from Postgres through the Ren server.                                                                                                                                                                                                                               | No second mapping of OpenCode rows on the Ren server in the first slice.                                            |
| C16 | Attachments are not in the first slice. Uploads get their own PR after the slice (§9 step 8).                                                                                                                                                                                                                                                                                     | User decision.                                                                                                      |
| C17 | No snapshot endpoint. `ChatApi` has one read per resource (session, status, messages, inbox, permissions, forms), as in OpenCode, so each is cached, invalidated and re-read on its own (SYNC-47 to SYNC-67).                                                                                                                                                                     | The OpenCode read logic ports unchanged; an event re-reads only what it touched.                                    |
| C18 | Members switch the model and variant of a session through `ChatApi` (`session.model.switch`), any number of times. The brain checks the model against its model list (agents X14), applies it, and keeps it as the session layer of its settings plan, so a later pull does not undo it. Reporting the choice to Ren comes later. The agent stays server-only (agents X15).       | A session-level override that changes often; the brain already owns the plan it applies.                            |
| C19 | Rename goes through the brain (`session.rename`); sync carries the title to Ren. The sidebar updates its own cache at once instead of waiting for sync.                                                                                                                                                                                                                           | The title belongs to the harness, as do generated titles.                                                           |
| C20 | Fork goes through the Ren server first: a fork is a new session, so a new Ren row and a new brain. It is the last step of the plan (§9 step 9).                                                                                                                                                                                                                                   | User decision.                                                                                                      |

## 2. Layers and data flow

```
 Ren server (Postgres)                      Brain (today: a cell, one Durable Object per session)
 ┌──────────────────────────┐               ┌────────────────────────────────────────┐
 │ session group (Api)      │  access()     │ ChatApi (scope: client)                │
 │ create, list, get,       │──────────────▶│  reads · events SSE · models           │
 │ access, archive, (fork)  │ url + token   │  prompt · interrupt · inbox · reply    │
 └────────────▲─────────────┘               │  revert · compact · shell · rename     │
              │ list, metadata              │            ▲                           │
              │ (TanStack Query)            │  translate │ allowlist, strip, add     │
              │                             │  OpenCode v2 (events, messages, forms) │
 ┌────────────┴──────────────────────────────────────────┐────────────────────────────┘
 │ @ren/chat  (no DOM, no React)                         │ ◀── SSE + HTTP, token refresh
 │  connection supervisor → batch (16 ms) → reducer      │
 │  outbox / send chain · reads (dedupe, settle)         │
 │  projection (turns, rows, groups) · Atom families     │
 ├───────────────────────────────────────────────────────┤
 │ @ren/chat/react  (useAtomValue, useAtomSet)           │
 └───────────────┬───────────────────────────────────────┘
                 │
     @ren/ui (DOM components)  ──▶  @ren/app (features/session, routes, Platform)
                                    later: desktop host, React Native app (own UI)
```

Layering additions for root `AGENTS.md`:

- `cell` may depend on `protocol`, only to serve `ChatApi` (C14).
- `chat` depends only on `schema`, `client` (its `effect` entries) and `util`. It never imports `core`, `db`, `server`, `brain-api` or DOM globals. A boundary test enforces this (like OpenCode's `session-ui/src/import-boundaries.test.ts`).
- `app` builds on `chat` as well.

### 2.1 Generated clients

`@ren/client` today generates from one API: `ClientApi` in `@ren/protocol/client`, which is the Ren server's `Api`. Putting `ChatApi` in `protocol` does not put it in the client by itself. `packages/client/script/generate.ts` compiles `ChatApi` as a second contract into its own folders, with its own entrypoints:

| Entrypoint                | From      | Notes                                                                                          |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `@ren/client`             | `Api`     | Unchanged.                                                                                     |
| `@ren/client/effect`      | `Api`     | Unchanged.                                                                                     |
| `@ren/client/chat`        | `ChatApi` | Promise client; base URL and token come from `session.access`.                                 |
| `@ren/client/chat/effect` | `ChatApi` | Effect client with decoded schemas, including the SSE event stream. `@ren/chat` uses this one. |

`test/import-boundaries.test.ts` gets the new entrypoints. `@ren/sdk` re-exports them, so SDK users can follow a session too.

## 3. Schema: OpenCode-shaped, Ren-owned

New modules in `@ren/schema`, copied from `@opencode/schema` 2.0.27 and renamed to Ren identifiers:

| Module                                          | Holds                                                                                                                                                              | OpenCode source                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `session-message`                               | Message union (user, synthetic, system, skill, shell, assistant, compaction, idle, agent- and model-switched), content (text, reasoning, tool and its four states) | `session-message.js`           |
| `session-inbox`                                 | Pending input: delivery `steer \| queue`, admitted items                                                                                                           | `session-inbox.js`             |
| `session-event`                                 | The allowlisted event union and the stream envelope (`server.connected`, heartbeat, `stream.ended`)                                                                | `session-event.js`, `event.js` |
| `session-status`                                | `idle \| busy \| retry`, read per session family. Not an event: OpenCode v2 does not emit `session.status`. "Parked" is a client state after `stream.ended`.       | `session-status-event.js`      |
| `permission` (add to the agents module), `form` | Permission request and reply; form (question) fields, state and reply                                                                                              | `permission.js`, `form.js`     |
| `session-capabilities`                          | The capability flags (C6)                                                                                                                                          | new                            |
| `session-info`, `session-model`                 | The harness view of a session (title, cost, tokens, revert, capabilities); model references and the `model.list` item                                              | `session.js`, `model.js`       |
| `session-error`                                 | `{ type, message, status? }`                                                                                                                                       | `session-error.js`             |

Ren additions to the copied shapes:

- User messages carry `sender: { userId }` (spaces have several members). The cell sets it from `metadata.userID`.
- Session info comes from Ren (`space`, `createdBy`, `harness`, `capabilities`) and is merged with OpenCode's title, cost, tokens and status.
- Dropped: `location-switched`, `session.moved`, instructions text, provider state, everything outside one session.
- The event allowlist is the `SessionEvent.Event` union itself: the brain decodes each OpenCode event with it, which drops unknown types and strips unknown fields (`cell/src/harness/opencode/translate.ts`).
- Client-minted message IDs use OpenCode's ascending format (`SessionMessage.ID.create()`), since revert compares IDs.

## 4. Brain: `ChatApi`

Defined in `@ren/protocol/chat` (C14) as four groups (`event`, `model`, `session`, `shell`), all under `/chat/*`. Served by the brain for its session and that session's children. The worker lets a `client`-scope token reach `/chat/*` only, answers CORS for it, and passes the token's `sub` (the member) to the brain, which records it as the message's sender. Raw OpenCode routes are for `server`-scope tokens only. Replaces the OpenCode deny-list in `cell/src/harness/opencode/routes.ts`. "Slice" ships in §9 steps 1–6; "B" ships with its inventory area.

Reads (C17):

| Endpoint                                   | Purpose                                                                                                   | OpenCode call                            | When  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----- |
| `event.subscribe` (SSE)                    | `server.connected` first, keepalive every 15 s, allowlisted events for the session family, `stream.ended` | `event.subscribe`                        | Slice |
| `session.get`                              | Title, cost, tokens, status, revert boundary, capabilities                                                | `session.get`                            | Slice |
| `session.status`                           | Which sessions of the family run; re-read on every connect                                                | `session.active`                         | Slice |
| `session.messages`                         | A page of messages, newest first, with a cursor                                                           | `session.messages`                       | Slice |
| `session.message`                          | One message, re-read after a model switch (SYNC-103)                                                      | `session.message`                        | B     |
| `session.children`                         | Subagent sessions                                                                                         | `session.list` by parent                 | B     |
| `session.inbox.list`                       | Pending and queued inputs                                                                                 | `session.inbox.list`                     | Slice |
| `session.permission.list`                  | Open permission requests                                                                                  | `session.permission.list`                | Slice |
| `session.form.list`                        | Open questions                                                                                            | `session.form.list`                      | Slice |
| `model.list`                               | Models the session may use, with their variants. Only the models Ren configured for this brain.           | `model.list`                             | Slice |
| `shell.list`                               | Shell commands that still run where the session works (SES-117)                                           | `Shell.list` in the session's instance   | B     |
| `shell.output`                             | Live output of a shell tool, by cursor (RND-136, RND-137)                                                 | `Shell.output` in the session's instance | B     |
| `command.list`, `agent.list`, `skill.list` | Composer lists for `/` and `@`                                                                            | same                                     | B     |

Writes:

| Endpoint                                                                | Purpose                                                                      | OpenCode call                            | When                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- | --------------------- |
| `session.prompt`                                                        | `{ id, text, delivery: steer \| queue, mentions }`; idempotent by message ID | `session.prompt`                         | Slice (files: step 8) |
| `session.interrupt`                                                     | Stop the turn                                                                | `session.interrupt`                      | Slice                 |
| `session.model.switch`                                                  | `{ model, variant? }`, any number of times (C18)                             | `session.switchModel`                    | Slice                 |
| `session.permission.reply`                                              | `once \| always \| reject`                                                   | same                                     | Slice                 |
| `session.form.reply`, `session.form.cancel`                             | Answer or dismiss a question                                                 | same                                     | Slice                 |
| `session.inbox.update`, `session.inbox.cancel`                          | Steer or queue a pending input, or cancel it (queue edit, reorder, undo)     | same                                     | B                     |
| `session.rename`                                                        | Change the title; sync carries it to Ren (C19)                               | `session.update`                         | B                     |
| `session.command`, `session.shell`, `session.compact`                   | `/` commands, `!` shell, compaction                                          | same                                     | B                     |
| `session.revert.stage`, `session.revert.clear`, `session.revert.commit` | Undo, redo, and commit before the next prompt                                | same                                     | B                     |
| `session.background`                                                    | Move running work to the background                                          | same                                     | B                     |
| `shell.remove`                                                          | Stop a background shell from the running menu (SES-109)                      | `Shell.remove` in the session's instance | B                     |

Not exposed: `switchAgent` (server-only, agents X15), session create, remove, import, export, move and environment (Ren owns the session), synthetic, `permission.create` and `form.create` (harness-internal), wait, generate, log, stats, skill (internal or experimental), and everything outside one session (config, provider, mcp, pty, fs, vcs, worktree, location, project, credential, integration). `diff`, `context` and `view` come back only if the review panel or unread state needs them.

The model switch (C18): the brain checks the model and variant against its model list (agents X14), calls `switchModel`, and stores the choice as the session layer of its in-memory settings plan and in the host's storage, so a later settings pull or a restart does not undo it. A `model-switched` event then arrives on the stream. The composer awaits the switch before it sends a steer (CMP-94), so the next turn uses the new model. Reporting the choice to Ren's `overrides` comes later.

Stream lifetime: an open stream holds the harness. The brain ends the stream (`stream.ended`) after the session has been idle for a set time; the client then shows the session as parked and reconnects on the next action or when the user returns. (Roadmap §2.)

## 5. Ren server: the session group

A `session` group in `Api` (exposure `sdk`). Wire `Session.layer` and `BrainHost.layer` into `server/src/routes.ts`, then `bun run generate`.

| Endpoint          | Purpose                                                                                                                          | When      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `session.create`  | Create a session in a space, optionally with its first message. The client mints the ID (SYNC-82).                               | Slice     |
| `session.list`    | Sidebar list, paged: title, status, updated time. From Postgres. Without `spaceId`, the chats the member started, across spaces. | Slice     |
| `session.get`     | Ren's data for one session: space, creator, harness, capabilities, status                                                        | Slice     |
| `session.access`  | `{ url, token, expiresAt }` for the brain; called again before the token expires                                                 | Slice     |
| `session.archive` | Hide a session                                                                                                                   | Slice     |
| `session.fork`    | `{ sessionId, messageId }` → a new session (C20)                                                                                 | §9 step 9 |

## 6. `@ren/chat`: the shared runtime

Ported from OpenCode. The file map below is the starting point; the inventory has the detail.

| `@ren/chat` module | Does                                                                                                                                                                    | OpenCode source                                                         | Inventory                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `connection`       | SSE over fetch, `server.connected` handshake (2 s), idle watchdog (45 s), 1 s reconnect, page lifecycle, forced resync, token refresh, batch flush (16 ms)              | `client/src/solid/connection.ts`, `client/src/shared-events.ts`         | SYNC-01 to SYNC-46                       |
| `reads`            | Read dedupe and serial invalidation, burst settle (150 ms), hydration overlays (events that beat a read)                                                                | `client/src/solid/data.ts` (`createSync`, `settle`, overlays)           | SYNC-47 to SYNC-67                       |
| `reducer`          | Pure `(state, event) → state` for every allowlisted event: text, reasoning and tool deltas, steps, retry, status, inbox, revert, compaction, permissions, forms, family | `client/src/solid/data.ts` (`handleEvent`)                              | SYNC-68 to SYNC-181                      |
| `outbox`           | Client message IDs, optimistic rows, per-session send chain, rollback only when unacknowledged, retry with the same ID                                                  | `client/src/solid/data.ts` (`prompt`, `sendAdmission`, `outbox`)        | SYNC-82 to SYNC-88, SYNC-126 to SYNC-146 |
| `projection`       | Turns, rows and stable row keys, tool grouping, detail presets, thinking row, retry and error rows, interrupted divider                                                 | `session-ui/src/timeline/projection.ts`, `detail.ts`, `timeline-row.ts` | RND-09 to RND-52                         |
| `atoms`            | Atom families per session: info, messages, pending, permissions, forms, status, rows; registry per signed-in user                                                       | new (t3code `client-runtime/src/state/*` for shape)                     | —                                        |
| `react`            | Hooks over the atoms                                                                                                                                                    | new                                                                     | —                                        |

Rules:

- Keep the reducer a pure function with no Effect and no Atom inside it. Atoms wrap it. Tests call it directly.
- Apply each batch of events in one registry update.
- Never drop an event for an unknown message silently: mark the transcript stale and re-read (SYNC-100, SYNC-119).

Where the port differs from OpenCode:

- The reducer returns read commands (`Refresh`, `Revalidate`, `Settle`, `Complete`, `Rename`) instead of calling the API; `ChatSession` runs them through `Reads`, the port of `createSync`.
- A delta for an assistant message the client does not have asks for a debounced transcript re-read; OpenCode drops it.
- A successful `session.prompt` acknowledges its optimistic row, as the echo does. A prompt sent while the stream is parked misses its echo, and the re-read after the reconnect would otherwise keep the row forever.
- After `stream.ended` the connection is `parked` and does not reconnect until `wake`, which every send calls. The host calls `wake` when the member returns, and `resync` on visibility and network changes.
- The connection re-reads every read the UI asked for after each `server.connected`, so views do not track the connection themselves.
- The client token goes in Basic auth (`ren:<token>`), which the cell worker reads.

## 7. `@ren/ui` and `@ren/app`

`@ren/ui` gets the visual pieces, each with a story and a spec, at ren-v1 parity ([inventory 05](inventory/05-ren-v1.md#components-list)): transcript rows (user, assistant text, reasoning, tool, tool group, file change, notice, divider, retry, error), the composer (editor, attachments, toolbar, queue panel, alternate delivery), the permission and question docks, the jump-to-latest button, and the timeline scroller. Rendering logic that needs the DOM (streaming markdown blocks, pacing, scroll follow, virtualization) lives here, ported from `session-ui/src/components/*` and `app/src/session/timeline/*`.

`@ren/app` gets `features/session/` and the route `/sessions/$sessionId`, fills the sidebar Chats list, and extends `Platform` where the composer needs it (draft store, clipboard image, keyboard insets). `packages/app/AGENTS.md` changes: live chat state lives in `@ren/chat` atoms, not in the query cache.

## 8. Lessons from t3code

t3code normalizes on its server, as Ren will. Its problems come from how it stores the result, and set rules here:

| t3code problem                                                                    | Rule for Ren                                                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Each token delta was a durable event: 90–120× write amplification (#5110, #19105) | C2, C13: no event store; deltas are live only.                         |
| Full native payloads copied into rows, up to 54 MiB (#10924)                      | Never copy native payloads; keep a native reference only.              |
| Replaying a large backlog froze the UI (#4596)                                    | Bounded first page, paged history, batched apply.                      |
| Unknown approval kind dropped, thread hung (#4795)                                | C7.                                                                    |
| Runs stuck on "running" (#15197, #17512)                                          | Re-read the transcript when a turn ends with an open tool (SYNC-119).  |
| User-installed CLI versions broke adapters (#8292, #11790)                        | The cell pins the OpenCode version; C4 contract test on every upgrade. |
| v1 client refused by v2 server (#14901)                                           | C7; additive schema changes only; no hard version refusal.             |

## 9. Build order

1. **Schema.** Copy the subset (§3), add Ren fields and capabilities. Contract test in the cell.
2. **`ChatApi`.** The contract in `@ren/protocol`, then in the cell: translation and allowlist, the "Slice" endpoints of §4 including the model switch, scope dispatch, stream end when idle.
3. **Ren session group and clients.** The "Slice" endpoints of §5 and wiring. Extend `packages/client/script/generate.ts` for `ChatApi` (§2.1), then `bun run generate`.
4. **`@ren/chat` core.** Connection, reads, reducer, outbox, atoms, with the OpenCode tests ported first.
5. **UI slice.** Minimal rows, composer and docks in `@ren/ui` with stories.
6. **App slice.** Route, feature, sidebar list. This meets the roadmap's "done when". The e2e stack (`packages/e2e/script/serve.ts`) runs celld with the stub model, and `tests/app/chat.spec.ts` is the journey. The transcript rows compose `@ren/ui` parts in `features/session/session-transcript.tsx`; streaming pacing, scroll follow and the remaining row kinds come with step 7.
7. **Inventory, area by area.** Each area adds its "B" endpoints from §4. Streaming and rendering quality (RND-53 to RND-164), timeline and scroll (SES-01 to SES-86), docks (SES-87 to SES-102), composer and platform (CMP-\*, PLT-\*), revert and subagents (SES-103 to SES-107, SES-109 to SES-120), notifications, shortcuts and mobile (SES-121 to SES-155), then the `todo` and `rethink` rows of 05. Rows about OpenCode-only surfaces (multi-server, directories, worktrees, MCP catalogs, desktop sidecar) are set to `n/a` when their area is reached.
8. **Uploads (own PR).** How files reach the session and its environment: upload path, size limits, inline versus path, progress and cancel (CMP-33 to CMP-47, V1-82 to V1-87). Today `Session.File` is a data URL of at most 10 MB.
9. **Fork (last).** `session.fork` on the Ren server (C20). Ren flushes the source session (`BrainHost.flush`), creates the new session in the same space with a link to its source, and starts the new brain from the source's synced messages before `messageId` (the restore of synced session trees on start). The client then opens the new session with the forked prompt in the composer (SES-108). The server side is built (`chat.fork`, `SessionDirectory.fork`, `forkedFrom` on `Session.Info`); the app action that calls it and fills the composer comes later.

## 10. Tests

- Port OpenCode's tests with the code: `client/test/solid-*.test.ts`, `session-ui/src/**/*.test.ts`, `app/src/**/*.test.ts`. Their names pin behaviors listed in the inventory.
- Reducer and projection tests are plain `bun test` on pure functions.
- The contract test (C4) runs OpenCode in the cell and decodes its messages and events with Ren's schemas.
- UI through Storybook stories and Playwright specs.
- End-to-end journeys from [brain-hand-testing](../brain-hand-testing.md) §5.2.

## 11. Open questions

| ID  | Question                                                                   | Proposal                                                                           |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Q1  | Permissions and forms are lost when the harness closes.                    | Upstream ask (roadmap §2). Until then the cell must not park with an open request. |
| Q2  | Package name for the shared runtime.                                       | `@ren/chat`.                                                                       |
| Q3  | Who may get a `debug` token?                                               | Open in the roadmap.                                                               |
| Q4  | Read transcripts from Postgres without waking the cell (previews, search)? | After the slice (C15). It needs the OpenCode-to-Ren mapping on the Ren server too. |
