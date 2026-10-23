# Piece E: restore on access

Status: spec written. Decisions: E98–E118, E126–E131, E133 (README §6). It also uses E39 (interrupted chats), E55 (synthetic message, M1 item 11), E68 (start runs), E76 (daily cleanup), E84 (pending messages), E89 (in-place update) and the restore flag per chat (M1 item 8).

## Goal

A brain gets each chat back from Postgres when the chat is first used. This works after a sandbox is replaced, after a harness upgrade, on any sandbox provider, with either brain scope, and with any hand. Postgres is the authority for transcripts; the harness database in a brain is a cache (E99). While the brain is not ready, the app shows the saved history from Ren (E108). Chats that retention deletes leave Postgres and every brain (E101, E102, E109).

Not in this piece:

- Harness-neutral tables in Ren (piece J). Ren's tables stay OpenCode-specific; every contract in this piece is already harness-neutral (E115).
- Upload of only the changed rows (piece J, E31). A busy chat can still lose up to 5 min of a turn when its sandbox is lost.
- Backup of workspace files. Files on a new sandbox are lost; the agent is told (E105).

A space brain loads chats lazily: a chat group comes back on its first request, never at boot. Any read across chats goes to Ren, not to the brain's cache (E116).

## Layers

```
 app ──Session.access──▶ Ren ──▶ starting | failed ──▶ app reads Ren's session.messages (E108, E111)
                             └─▶ ready { url, token } ──▶ app reads and prompts the brain
                                                              │
 brain                                                        ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ brain core (no harness or host types)                                                     │
 │   Chat API entry, Brain API entry ──▶ Restore.ensure(chat) (E98, E103, E107)               │
 │   pull: roots → deleted → drop (E109, E114) · upgrade: flush, clear cache (E100)           │
 │        │ Transcript (harness adapter)                     │ HarnessStorage (host)          │
 │   ┌────▼───────────────────────────────────────────┐ ┌────▼──────────────────────────┐     │
 │   │ OpenCode: version · has · restore · drop ·      │ │ Bun: file · workerd: DO SQL   │     │
 │   │ roots · note · stageRevert (Pi: its own)        │ │ clear() (E115)                │     │
 │   └─────────────────────────────────────────────────┘ └───────────────────────────────┘     │
 └──────────────────────┬───────────────────────────────────────────────────────────────────┘
                        │ /host/sync/restore { harness, harnessVersion, parentId, rows } · /host/pull
                        ▼
 Ren: SessionSync (soft delete, group restore) · retention run · TranscriptCodec.Registry (E115)
      OpenCode codec in server, on @ren/opencode-transcript
```

No part of this piece names a sandbox provider. A new sandbox is only an empty cache (E103).

## Services

### `Restore` (brain core, E98, E103, E107, E113)

```ts
export interface Interface {
  // Makes sure the harness has `chat` and its whole group (root, parent chain, subagent chats).
  readonly ensure: (chat: Session.ID) => Effect.Effect<void, Unavailable>
}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Restore.Unavailable", { message: Schema.String }) {}
```

1. Take the lock of the chat's group. Concurrent calls for one group wait on one restore.
1. If the chat has no saved settings in `brain.db`, pull first (E131). Ren unreachable: fail with `Restore.Unavailable`.
1. If the adapter has the chat (`has`) and the group's root has no restore flag, return.
1. Get the group from Ren (`/host/sync/restore`). Ren unreachable: fail with `Restore.Unavailable`; the entry answers 503 with `Retry-After`.
1. Set the restore flag on the root in `brain.db` (the flag per chat from M1 item 8).
1. For each chat of the group that the adapter does not have, parents first by `parentId`: `restore(rows)`; or, for a chat without a transcript, the harness's `start` with the start input (E106).
1. For each restored chat on the brain's own hand whose folder did not exist before the restore: `note(chat, …)` (E105, E113).
1. For each restored chat with a staged revert: `stageRevert(chat, messageId)` (E112).
1. Remove the restore flag.

Callers: the Chat API's `ChatAccess` middleware, for every route under `/chat/session/:sessionID`, with the client token's chat (`cell/src/chat.ts`); and the Brain API handlers `brain.start`, `brain.send` and `brain.setModel` (`cell/src/brain.ts`). `brain.start` passes `isStarting`: the restore leaves the chat it starts to that start (E138). `OpenCodeHarness.start` stops calling `sync.restore` itself (`cell/src/harness/opencode/harness.ts:365-388`). `Restore.ensure` never runs inside a harness hook or the workspace driver (ren-v1 INV-57).

### `Transcript` (harness adapter, E100, E103, E104, E109, E112, E115)

| Member                         | Contract                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `version`                      | The harness version, for example `opencode 2.0.27`. Uploads tag rows with it.                                                 |
| `has(chat)`                    | Whether the harness database has the chat.                                                                                    |
| `restore(rows)`                | Imports one chat with its queued messages (E110), all or nothing. Converts rows of an older `harnessVersion` (ren-v1 INV-58). |
| `roots()`                      | The root chat ids the harness database holds (E109).                                                                          |
| `drop(chat)`                   | Removes the chat and its subagent chats from the harness database (E109).                                                     |
| `note(chat, text)`             | Adds a synthetic message, as for E55.                                                                                         |
| `stageRevert(chat, messageId)` | Hides `messageId` and the messages after it, as the Chat API's `session.revert.stage` does (E112).                            |

OpenCode `restore` (E104, E113): when the chat's folder is on the brain's own hand, create it; then `workspaces.create` with `RenWorkspaceDriver.workspaceId(chat)`; then the in-process `SessionTransfer.import` with the stored `{ directory, workspaceID }`; then put the queued messages back in the inbox. Not the HTTP import route, and not `SessionMove`.

`changed` and `rows` (sync) stay as today (`brain/src/opencode-sync.ts`) and join `Transcript` in piece J. Sync takes a check from brain core and skips a group with a restore flag.

### `HarnessStorage.clear` (host, E100, E115)

Removes the harness database: the Bun host deletes `/home/user/.ren/opencode.db`; the workerd host drops the harness tables in Durable Object SQL.

### `TranscriptCodec` (Ren, E108, E115)

```ts
export interface Codec {
  readonly messages: (rows: ReadonlyArray<Schema.Json>, harnessVersion: string) => ReadonlyArray<SessionMessage.Info>
}

export interface Interface {
  readonly get: (harness: Session.Harness) => Option.Option<Codec>
}
```

`TranscriptCodec.Registry` is in `core`, keyed by harness, as `EnvironmentProvider.Registry` is. The OpenCode codec is registered in `server/src/main.ts`, on `@ren/opencode-transcript`. That new package holds the pure row and message translation that moves out of `cell/src/harness/opencode/opencode-rows.ts` and `translate.ts`. It depends only on `@ren/schema` and `@opencode/schema`; `cell` and `server` use it.

### Runs (Ren)

| Key                | Does                                                                                                                                                                                                                                           | Decision   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `retention:<date>` | Daily. Deletes each root chat, with its subagent chats and transcript, whose last activity (the later of `agent_session.created_at` and `opencode_session.time_updated`) is more than 30 days old. Deletes rows removed more than 30 days ago. | E101, E102 |

A brain with no chat left is resting, so the daily cleanup destroys its sandbox (`core/src/brain-lifecycle.ts:316-320`, E76). That covers every session-scope brain whose chat retention deletes.

## Behaviour

### Restore reply (E103, E106, E110, E115)

- `/host/sync/restore` takes one chat id. Ren returns that chat's group only, parents first. Ren resets `sync_seq` only for that group. Today Ren returns and resets every chat of the brain (`core/src/session-sync.ts:191-195`).
- Each chat in the reply is `{ harness, harnessVersion, parentId, revertMessageId, rows, start? }`. `rows` is JSON that only the adapter reads: for OpenCode, the session row, its messages and its queued messages, page by page. Rows with `removed_at` are left out (E101).
- `start` is present when the chat has no transcript. It is the start input with the first message and its `messageId`. `agent_session.start_input` keeps the first message (today it drops it, `core/src/session/runner.ts:72`).
- A start run (E68) that reaches the brain after such a restore is a no-op: the chat exists, and `send` skips a known message id (`harness.ts:278`).

### Hand link and lost files (E104, E105, E113)

- A restored chat keeps its workspace link, so its tools run on its hand in the same folder (closes `harness.ts:393` and P5-08). The binding of chat to hand lives in Ren (`session_environment`), so a restore never contacts a hand.
- Only for a chat on the brain's own hand: brain core checks the folder on the local disk before the import. When the folder did not exist, the chat gets one synthetic message after the import: workspace files from before the restore are gone; the chat history is kept.
- The user is told too (E117): the brain reports `filesResetAt` for that chat with the next sync, Ren stores `agent_session.files_reset_at`, and the app shows a notice in the timeline at that time, in live and saved history.

### Harness upgrade (E100)

1. An update (E89) waits until no chat is busy and no group has a restore flag (E107).
2. The old version flushes sync. When the flush drains, it writes `flushedVersion = <old version>` in `brain.db`. When it does not drain, the update waits for the next idle moment.
3. The new version starts. Before it opens the harness database: if `brain.db` holds a harness version other than its own and `flushedVersion` equals that version, it calls `HarnessStorage.clear()`. Then it writes its own version.
4. Workspace files stay. Each chat comes back on its first request.

### Soft delete, revert and retention (E101, E102, E112)

- A commit no longer deletes messages that are missing from an upload. It sets `removed_at` on them (`core/src/session/opencode-store.ts:54`). A message that comes back in a later upload has `removed_at` cleared.
- A commit also writes `agent_session.revert_message_id`: the first message a staged revert hides, or null.
- Restore and `session.messages` skip removed rows. `session.messages` also hides `revert_message_id` and the messages after it.
- The retention run deletes removed rows 30 days after `removed_at`, and deletes whole chats 30 days after their last activity.

### Deleted chats on a brain (E109, E114)

- The `/host/pull` request lists `Transcript.roots()`. The reply's `deleted` lists those roots without an `agent_session` row.
- For each, when idle, brain core calls `Transcript.drop` at once. It stores the first time Ren named the chat deleted in `brain.db`. After 7 days of `deleted` answers, it removes the chat's folder, but only on a `managed` hand (the brain's own hand or a template's machine). A chat that Ren lists again in that time loses its date.
- The brain never drops a chat only because Ren does not list it: subagent chats start in the brain and reach Ren at their first sync.

### History while not ready (E108, E111)

- Ren adds a read-only `session.messages` to its Session API, with the same query (`limit`, `cursor`) and response type as the Chat API's (`protocol/src/chat.ts:163`). It checks access as `Session.get` does.
- Read limits as ren-v1: 4 reads at once, 16 queued for at most 2 s, 48 MiB in flight, a page of at most 16 MiB or 20,000 rows, a 5 s statement timeout. 503 with `Retry-After: 2`; 413 when a page is too large. `data:` URLs longer than 1024 characters are cut.
- The chat runtime reads history from Ren while `Session.access` returns `starting` or `failed`, and from the brain after `ready`. On 413 it steps the page size down 100, 50, 25, 5, 1; on 503 it retries up to 3 times per page. A file shown by `uri` that does not load shows its name and icon. Every message sent while the brain is not ready stays in local storage per chat, with its id, until the brain accepts it; after a reload or a Retry the app sends it again with the same id (E118).

### Client behaviour around the brain's lifecycle (E126–E130, E133)

```
 send ──▶ outbox (browser storage, E118) ──▶ brain
            │ network error / 401 ──▶ keep pending ──▶ Session.access(unreachable, E123) ──▶ resend, same id (E126)
 stream ends "closing" (token expiry) ──▶ reconnect now with new access (E127)
 stream ends "idle"                  ──▶ park; drop cached access (E128)
 parked + read/send                  ──▶ Session.access first (wakes the brain); saved history from Ren meanwhile
 parked + typing                     ──▶ prepare, once per 5 min per chat (E130)
 question stopped after 10 min        ──▶ shown expired; an answer becomes a message quoting it (E129)
```

- Only a refusal by the brain (a 4xx other than 401) removes a pending message. The brain skips an id it already has, so a resend never makes a second turn.
- Ren's own senders follow the same contract with a durable `send:<messageId>` run (E77, E133).

## Swap and scope check

| Change                       | What changes                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Sandbox provider (Daytona)   | Nothing in this piece.                                                                                              |
| Host (Bun, workerd)          | `HarnessStorage.clear` per host.                                                                                    |
| Harness (Pi)                 | A `Transcript` adapter in the brain and a codec in `TranscriptCodec.Registry`. Ren tables move to piece J.          |
| Brain scope (session, space) | Nothing. A group is one root chat with its subagent chats in either scope; cleanup covers brains with no chat left. |
| Hand (laptop, phone)         | Nothing for restore. A user's hand is not `managed`, so E114 never deletes its files; E105 does not check it.       |

## Contract changes

| Package                        | Change                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                           | `opencode_message.removed_at timestamp`. `agent_session.harness_version text`, `agent_session.revert_message_id text`, `agent_session.files_reset_at timestamp`. `agent_session.start_input` type includes `initialMessage`. Ren stores OpenCode's queued messages.                                                                                                                                |
| `schema`                       | `Environment` hand gains `managed: boolean`.                                                                                                                                                                                                                                                                                                                                                       |
| `host-api`                     | `sync.restore`: one chat's group; each chat `{ harness, harnessVersion, parentId, revertMessageId, rows, start? }`. Sync uploads carry queued messages and `revertMessageId`. `/host/pull`: request `roots`, reply `deleted`.                                                                                                                                                                      |
| `core`                         | `SessionSync.restore` per group; `commit` sets `removed_at` and `revert_message_id`; `TranscriptCodec.Registry`; `Session.messages` with read limits; retention run on `DurableRunner`; `start_input` keeps the first message.                                                                                                                                                                     |
| `protocol`                     | Session API: `GET` messages of a session, Chat API message type, 503 and 413 errors. Run `bun run generate`.                                                                                                                                                                                                                                                                                       |
| new `@ren/opencode-transcript` | Pure OpenCode row and message translation, moved from `cell`. Depends on `@ren/schema` and `@opencode/schema`. `AGENTS.md` layering gets a line for it.                                                                                                                                                                                                                                            |
| `cell`                         | `Restore` and its callers; `Transcript` in the harness interface; `HarnessStorage.clear`; upgrade check at boot; pull `roots` and `deleted`; the 7-day folder date in `brain.db`.                                                                                                                                                                                                                  |
| `server`                       | Registers the OpenCode codec in `main.ts`; the Session API handler for messages.                                                                                                                                                                                                                                                                                                                   |
| `chat`, `app`                  | Pending sends kept and resent on network error or 401 (E126); reconnect on `closing` (E127); drop cached access on park (E128); expired questions (E129); `prepare` on typing when parked (E130). Read history from Ren while access is `starting` or `failed`, with page stepping and retry; the file fallback tile; the files-reset notice (E117); unsent messages kept in local storage (E118). |

## Lifecycle states

| State                      | What happens                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| asleep, waking             | No restore: the disk is kept. The app shows history from Ren until `ready` (E108). Deleted chats are dropped after the wake pull (E109). Restore is not part of the wake, so a wake stays short (ren-v1 DS-L1). |
| replaced (new sandbox)     | Empty cache. Each chat restores on its first request, with its queue (E110); busy chats were already `interrupted` (E39). An unfinished reply is not restored; Postgres keeps it as removed (E107).             |
| mid-turn                   | A restore never runs for a chat the harness has. An upgrade and a drop wait for idle.                                                                                                                           |
| down (Ren)                 | A restore answers 503 and keeps its restore flag; the app retries. Drops wait. History from Ren is not available; the app shows the phase.                                                                      |
| down (hand)                | No effect on restore (E113). A folder removal on a managed hand waits until the hand answers.                                                                                                                   |
| restarting (brain process) | A group with a restore flag resumes on its next request and copies only the missing chats (E107). An upgrade restart clears the cache only after a drained flush (E100).                                        |

## Tests

Write each test first. Each test must fail before its change. Brain tests run the Bun brain with a real OpenCode and a real Ren (`cell/test/lib`); core tests use `layerLocal` (E65). No mocks.

| #   | Package and file                                                                        | Test                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `core/test/restore.slow.test.ts`                                                        | A chat with two subagent chats, synced, then the harness database cleared: the first `session.messages` from the app returns the whole history, and both subagent chats exist (INV-55, INV-56).                                                                 |
| 2   | `core/test/restore.slow.test.ts`                                                        | A prompt and a `session.get` sent at once to a chat that needs a restore: one restore runs, and the prompt's message comes after the restored history (INV-69).                                                                                                 |
| 3   | `core/test/restore.slow.test.ts`                                                        | Ren unreachable during a restore: 503 with `Retry-After`, and the restore flag stays. Ren back: the next request restores.                                                                                                                                      |
| 4   | `core/test/restore.slow.test.ts`                                                        | Kill the brain between two subagent imports: the next request copies only the missing chat and creates no duplicate message (P5-03, INV-51).                                                                                                                    |
| 5   | `server/test/opencode-sync.test.ts`                                                     | While group A has a restore flag, a sync step uploads chat B and skips A (E107).                                                                                                                                                                                |
| 6   | `e2e/chaos/cases/real-stack.test.ts`                                                    | P5-08 becomes a test: a chat on a template's machine restores, and its next shell call reads a file it wrote before. A chat on the brain's own hand restores and runs `shell` in `/…/workspace/<chatId>` (E104).                                                |
| 7   | `core/test/restore.slow.test.ts`                                                        | A chat on the brain's own hand restored into a missing folder: the folder exists before the import and the chat gets one synthetic message. Restored into an existing folder: no message (E105, E113).                                                          |
| 8   | `core/test/restore.slow.test.ts`                                                        | A chat with no transcript in Postgres restores as a start: the first message is there and its turn runs once. A later start run with the same message id adds nothing (E106).                                                                                   |
| 9   | `core/test/restore.slow.test.ts`                                                        | A chat with two queued messages behind a running turn, then the harness database cleared: after the restore both messages are queued and reconcile delivers them in order (E110).                                                                               |
| 10  | `core/test/restore.slow.test.ts`                                                        | A chat with a staged revert, then the harness database cleared: after the restore the hidden messages stay hidden, and `session.revert.clear` brings them back (E112).                                                                                          |
| 11  | `core/test/session-sync.test.ts`                                                        | `sync.restore` for chat A of a space brain returns A's group only, and leaves `sync_seq` of chat B unchanged.                                                                                                                                                   |
| 12  | `core/test/session-sync.test.ts`                                                        | A commit without message M sets `removed_at` on M and keeps the row; restore and `Session.messages` skip M; M in a later upload clears `removed_at` (E101).                                                                                                     |
| 13  | `core/test/restore.slow.test.ts` (Bun host), `cell/test/sync-storage.test.ts` (workerd) | `brain.db` names another harness version with `flushedVersion` equal to it: opening the harness clears its database, and a chat restores on its first request. With `flushedVersion` unset: it keeps it (E100, E115).                                           |
| 14  | `core/test/retention.test.ts`                                                           | Under `TestClock`: a chat with no activity for 30 days is deleted with its subagent chats and transcript; activity on day 29 keeps it; a row removed 31 days ago is deleted (E101, E102).                                                                       |
| 15  | `core/test/restore.slow.test.ts`                                                        | A pull that lists a root without a row gets it in `deleted`; the brain drops the chat at once. Under `TestClock`, its folder on the brain's own hand goes after 7 days, and not before. A new subagent chat that is not yet synced is not dropped (E109, E114). |
| 16  | `core/test/environments.test.ts`                                                        | A hand that is not `managed` never gets a folder removal for a deleted chat (E114).                                                                                                                                                                             |
| 17  | `core/test/restore.slow.test.ts`                                                        | For a synced chat, Ren's `chat.messages` returns the same messages as the brain's Chat API, page by page, and hides a staged revert (E108, E112).                                                                                                               |
| 18  | `core/test/session.test.ts`                                                             | A fifth read at once waits, a 21st is told to ask again; a page over 16 MiB is refused (E111, INV-63).                                                                                                                                                          |
| 19  | `chat/test/chat-session.test.ts`                                                        | Access `starting`: the history comes from Ren; a 413 makes the next page smaller. Access `ready`: the runtime switches to the brain and shows each message once (E108, E111).                                                                                   |
| 20  | `server/test/opencode-sync.test.ts`                                                     | A chat over 20 MB restores page by page; no request is over the body limit (INV-53).                                                                                                                                                                            |
| 21  | live, skipped without `E2B_API_KEY`                                                     | Replace a brain's sandbox, then open its chat: history, subagent chats, queued messages and a shell call all work (asks the user first, README §7).                                                                                                             |
| 22  | `chat/test/chat-session.test.ts`                                                        | An open event stream during a restore: the app shows each restored message once, and no restored chat as new (ren-v1 `498070ea8`, `b54b041e1`).                                                                                                                 |
| 23  | `core/test/restore.slow.test.ts`                                                        | A restore into a missing folder on the brain's own hand sets `files_reset_at`; Ren's `session.messages` and the app show the notice at that time (E117).                                                                                                        |
| 24  | `chat/test/chat-session.test.ts`                                                        | A message sent while access is `starting`, then the runtime is rebuilt (a reload): the message is sent once after `ready`, with the same id. A send the brain already accepted is not sent again (E118).                                                        |
| 25  | `chat/test/chat-session.test.ts`                                                        | A prompt sent while the brain's URL fails stays pending; after new access it is sent once with the same id. A 401 from a token of an old generation does the same (E126).                                                                                       |
| 26  | `chat/test/connection.test.ts`                                                          | A stream that ends with `closing` reconnects without a wake; one that ends with `idle` parks (E127).                                                                                                                                                            |
| 27  | `chat/test/chat-session.test.ts`                                                        | After the connection parks, a history read asks for access before any request to the old URL (E128).                                                                                                                                                            |
| 28  | `chat/test/chat-session.test.ts`                                                        | A question whose turn stopped shows as expired; answering it sends one message that quotes the question (E129).                                                                                                                                                 |
| 29  | `chat/test/chat-session.test.ts`                                                        | Typing while parked calls `prepare` once, and not again within 5 min (E130).                                                                                                                                                                                    |
| 30  | `core/test/restore.slow.test.ts`                                                        | On a new sandbox, the first request is a prompt to a chat that needs a restore: the turn runs with the chat's agent, and a file tool is denied another chat's folder. With Ren unreachable the prompt gets 503 and no turn starts (E131).                       |

Edge cases from ren-v1 that these tests cover: INV-51 (4), INV-53 (20), INV-55 (1), INV-56 (1), INV-59 (7: folder before import), INV-60 and INV-54 (15, 16: drops only what Ren names, files only after 7 days and only on managed hands), INV-63 (18), INV-69 (2); `2ca54c9d4` (9), `394f7f48b` (10, 17), `7d5c7eb01` (18, 19). INV-58 (older row versions) has no test until a second OpenCode row version exists; the contract is in `Transcript.restore`.
