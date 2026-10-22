# Piece E: restore on access

Status: spec written. Decisions: E98–E109 (README §6). It also uses E39 (interrupted chats), E55 (synthetic message, M1 item 11), E68 (start runs), E84 (pending messages), E89 (in-place update) and the restore flag per chat (M1 item 8).

## Goal

A brain gets each chat back from Postgres when the chat is first used. This works after a sandbox is replaced, after a harness upgrade, and on any provider. Postgres is the authority for transcripts; the harness database in a brain is a cache (E99). While the brain is not ready, the app shows the saved history from Ren (E108). Chats that retention deletes leave Postgres and every brain (E101, E102, E109).

Not in this piece:

- Harness-neutral tables in Ren (piece J). Ren's tables stay OpenCode-specific; the contracts in this piece are already harness-neutral.
- Upload of only the changed rows (piece J, E31). A busy chat can still lose up to 5 min of a turn when its sandbox is lost.
- Backup of workspace files. Files on a new sandbox are lost; the agent is told (E105).

## Layers

```
 app ──Session.access──▶ Ren ──▶ starting | failed ──▶ app reads Ren's session.messages (E108)
                             └─▶ ready { url, token } ──▶ app reads and prompts the brain
                                                              │
 brain                                                        ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ brain core (no harness types)                                                             │
 │   Chat API entry, Brain API entry ──▶ Restore.ensure(chat) (E98, E103, E107)               │
 │   pull: roots → deleted → drop (E109) · upgrade: flush, mark, drop cache (E100)            │
 │                 │ Transcript                                                              │
 │   ┌─────────────▼───────────────────────────────────────────┐                             │
 │   │ OpenCode adapter: version · has · restore · drop         │  (Pi later: its own adapter) │
 │   │ restore = workspace create + in-process import (E104)    │                             │
 │   └──────────────────────────────────────────────────────────┘                             │
 └──────────────────────┬───────────────────────────────────────────────────────────────────┘
                        │ /host/sync/restore (group of one chat) · /host/pull (roots, deleted)
                        ▼
 Ren: SessionSync (soft delete, group restore) · Retention run · TranscriptCodec (E108)
      TranscriptCodec.layerOpenCode in server, on @ren/opencode-transcript
```

Nothing in this piece depends on a sandbox provider. A new sandbox is only an empty cache (E103).

## Services

### `Restore` (brain core, E98, E103, E107)

```ts
export interface Interface {
  // Makes sure the harness has `chat` and its whole group (root, parent chain, subagent chats).
  readonly ensure: (chat: Session.ID) => Effect.Effect<void, RestoreUnavailable>
}
```

1. Take the lock of the chat's group. Concurrent calls for one group wait on one restore.
2. If the adapter has the chat (`has`) and the group's root has no mark, return.
3. Get the group from Ren (`/host/sync/restore`). Ren unreachable: fail with `RestoreUnavailable`; the entry answers 503 with `Retry-After`.
4. Set the mark on the root in `brain.db` (the flag per chat from M1 item 8).
5. For each chat of the group, parents first, that the adapter does not have: `restore(rows)`; or, for a chat without a transcript, the harness's `start` with the start input (E106).
6. For each restored chat whose folder is missing on its hand: add the synthetic message (E105).
7. Remove the mark.

Callers: every Chat API handler that names a session (through `harnessed` in `cell/src/chat.ts`) and the Brain API handlers `brain.start`, `brain.send` and `brain.setModel` (`cell/src/brain.ts:76-104`). `OpenCodeHarness.start` stops calling `sync.restore` itself (`cell/src/harness/opencode/harness.ts:365-388`).

### `Transcript` (harness adapter, E100, E103, E104, E109)

| Member          | Contract                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | The harness version, for example `opencode 2.0.27`. Uploads tag rows with it.                                                                                                                                                   |
| `has(chat)`     | Whether the harness database has the chat.                                                                                                                                                                                      |
| `restore(rows)` | Imports one chat, all or nothing. Converts rows of an older `harnessVersion` (ren-v1 INV-58).                                                                                                                                   |
| `drop(chat)`    | Removes the chat and its subagent chats from the harness database. Only for E109.                                                                                                                                               |
| OpenCode        | `restore`: `workspaces.create` with `RenWorkspaceDriver.workspaceId(chat)`, then the in-process `SessionTransfer.import` with the stored `{ directory, workspaceID }` (E104). Not the HTTP import route, and not `SessionMove`. |

`changed` and `rows` (sync) stay as today (`brain/src/opencode-sync.ts`) and join `Transcript` in piece J.

### `TranscriptCodec` (Ren, E108)

```ts
export interface Interface {
  readonly messages: (
    harness: Session.Harness,
    rows: ReadonlyArray<Schema.Json>,
  ) => Effect.Effect<ReadonlyArray<SessionMessage.Info>>
}
```

The service is in `core`. `layerOpenCode` is in `server`, on `@ren/opencode-transcript`. That new package holds the pure row and message translation that moves out of `cell/src/harness/opencode/opencode-rows.ts` and `translate.ts`. It depends only on `@ren/schema` and `@opencode/schema`; `cell` and `server` use it. `server/src/main.ts` picks the layer.

### Runs (Ren)

| Key                | Does                                                                                                                                                                                                                                           | Decision   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `retention:<date>` | Daily. Deletes each root chat, with its subagent chats and transcript, whose last activity (the later of `agent_session.created_at` and `opencode_session.time_updated`) is more than 30 days old. Deletes rows removed more than 30 days ago. | E101, E102 |

## Behaviour

### Restore reply (E103, E106)

- `/host/sync/restore` takes one chat id. Ren returns that chat's group only, parents first. Ren resets `sync_seq` only for that group. Today Ren returns and resets every chat of the brain (`core/src/session-sync.ts:191-195`).
- Each chat in the reply carries `{ harness, harnessVersion, session, start? }`. `session` is the OpenCode session row; messages come page by page from `sync.messages`, as today. Rows with `removed_at` are left out (E101).
- `start` is present when the chat has no transcript. It is the start input with the first message and its `messageId`. `agent_session.start_input` keeps the first message (today it drops it, `core/src/session/runner.ts:72`).
- A start run (E68) that reaches the brain after such a restore is a no-op: the chat exists, and `send` skips a known message id (`harness.ts:278`).

### Hand link and lost files (E104, E105)

- A restored chat keeps its workspace link, so its tools run on its hand in the same folder (closes `harness.ts:393` and P5-08).
- Brain core checks the chat's folder on its hand before the import. When the folder is missing, it adds one synthetic message after the import: workspace files from before the restore are gone; the chat history is kept.

### Harness upgrade (E100)

1. An update (E89) waits until no chat is busy and no group is marked (E107).
2. The old version flushes sync. When the flush drains, it writes `harnessFlushed = <old version>` in `brain.db`. When it does not drain, the update waits for the next idle moment.
3. The new version starts. Before it opens the harness database: if `brain.db` holds a harness version other than its own and `harnessFlushed` names that version, it deletes the harness database. Then it writes its own version.
4. Workspace files stay. Each chat comes back on its first request.

### Soft delete and retention (E101, E102)

- A commit no longer deletes messages that are missing from an upload. It sets `removed_at` on them (`core/src/session/opencode-store.ts:54`). A message that comes back in a later upload has `removed_at` cleared.
- Restore and `session.messages` skip removed rows.
- The retention run deletes them 30 days after `removed_at`, and deletes whole chats 30 days after their last activity.

### Deleted chats on a brain (E109)

- The `/host/pull` request lists the root chat ids that the harness holds. The reply's `deleted` lists those roots without an `agent_session` row.
- For each, when idle, brain core calls `Transcript.drop` and removes the chat's folder on its hand.
- The brain never drops a chat only because Ren does not list it: subagent chats start in the brain and reach Ren at their first sync.

### History while not ready (E108)

- Ren adds a read-only `session.messages` to its Session API, with the same query (`limit`, `cursor`) and response type as the Chat API's (`protocol/src/chat.ts:163`). It checks access as `Session.get` does.
- The chat runtime reads history from Ren while `Session.access` returns `starting` or `failed`, and from the brain after `ready`. Messages typed meanwhile wait in local storage (E84).

## Contract changes

| Package                        | Change                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                           | `opencode_message.removed_at timestamp`. `agent_session.harness_version text`. `agent_session.start_input` type includes `initialMessage`.                                                                    |
| `host-api`                     | `sync.restore`: one chat's group; each chat `{ harness, harnessVersion, session, start? }`. `/host/pull`: request `roots: Session.ID[]`, reply `deleted: Session.ID[]`. New error `RestoreUnavailable` (503). |
| `core`                         | `SessionSync.restore` per group; `commit` sets `removed_at`; `TranscriptCodec`; `Session.messages`; retention run on `DurableRunner`; `SessionRunner.create` keeps the first message in `start_input`.        |
| `protocol`                     | Session API: `GET` messages of a session, Chat API message type. Run `bun run generate`.                                                                                                                      |
| new `@ren/opencode-transcript` | Pure OpenCode row and message translation, moved from `cell`. Depends on `@ren/schema` and `@opencode/schema`. `AGENTS.md` layering gets a line for it.                                                       |
| `cell`                         | `Restore` service and its callers; `Transcript` in the harness interface; OpenCode `restore` and `drop`; upgrade check at boot; pull `roots` and `deleted`.                                                   |
| `server`                       | `TranscriptCodec.layerOpenCode` in `main.ts`; the Session API handler for messages.                                                                                                                           |
| `chat`, `app`                  | Read history from Ren while access is `starting` or `failed`.                                                                                                                                                 |

## Lifecycle states

| State                      | What happens                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| asleep, waking             | No restore: the disk is kept. The app shows history from Ren until `ready` (E108). A deleted chat is dropped at the wake pull (E109).                                        |
| replaced (new sandbox)     | Empty cache. Each chat restores on its first request; busy chats were already `interrupted` (E39). An unfinished reply is not restored; Postgres keeps it as removed (E107). |
| mid-turn                   | A restore never runs for a chat the harness has. An upgrade and a drop wait for idle.                                                                                        |
| down (Ren)                 | A restore answers 503 and keeps its mark; the app retries. Drops wait. History from Ren is not available; the app shows the phase.                                           |
| restarting (brain process) | A marked group resumes on its next request and copies only the missing chats (E107). An upgrade restart drops the cache only after a drained flush (E100).                   |

## Tests

Write each test first. Each test must fail before its change. Brain tests run the Bun brain with a real OpenCode and a real Ren (`cell/test/lib`); core tests use `layerLocal` (E65). No mocks.

| #   | Package and file                        | Test                                                                                                                                                                                                                                         |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `server/test/cell-restore.slow.test.ts` | A chat with two subagent chats, synced, then the brain's harness database deleted: the first `session.messages` from the app returns the whole history, and both subagent chats exist (INV-55, INV-56).                                      |
| 2   | `server/test/cell-restore.slow.test.ts` | A prompt and a `session.get` sent at once to a chat that needs a restore: one restore runs, and the prompt's message comes after the restored history (INV-69).                                                                              |
| 3   | `server/test/cell-restore.slow.test.ts` | Ren unreachable during a restore: 503 with `Retry-After`, and the mark stays. Ren back: the next request restores.                                                                                                                           |
| 4   | `server/test/cell-restore.slow.test.ts` | Kill the brain between two subagent imports: the next request copies only the missing chat and creates no duplicate message (P5-03, INV-51).                                                                                                 |
| 5   | `server/test/cell-restore.slow.test.ts` | While group A is marked, a sync step uploads chat B and skips A (E107).                                                                                                                                                                      |
| 6   | `e2e/chaos/cases/real-stack.test.ts`    | P5-08 becomes a test: a chat on a template's machine restores, and its next shell call runs in the same folder and reads a file it wrote before. A chat on the brain's own hand restores and runs `shell` in `/…/workspace/<chatId>` (E104). |
| 7   | `server/test/cell-restore.slow.test.ts` | A chat restored into a missing folder gets one synthetic message; a chat restored into an existing folder gets none (E105).                                                                                                                  |
| 8   | `server/test/cell-restore.slow.test.ts` | A chat with no transcript in Postgres restores as a start: the first message is there and its turn runs once. A later start run with the same message id adds nothing (E106).                                                                |
| 9   | `core/test/session-sync.test.ts`        | `sync.restore` for chat A of a space brain returns A's group only, and leaves `sync_seq` of chat B unchanged.                                                                                                                                |
| 10  | `core/test/session-sync.test.ts`        | A commit without message M sets `removed_at` on M and keeps the row; restore and `Session.messages` skip M; M in a later upload clears `removed_at` (E101).                                                                                  |
| 11  | `cell/test/upgrade.test.ts`             | `brain.db` names another harness version with `harnessFlushed` set: boot deletes the harness database, and a chat restores on its first request. Without `harnessFlushed`: boot keeps it (E100).                                             |
| 12  | `cell/test/opencode-import.test.ts`     | A row with an older `harnessVersion` imports through the adapter's conversion (INV-58). Skipped until a second OpenCode row version exists.                                                                                                  |
| 13  | `core/test/retention.test.ts`           | Under `TestClock`: a chat with no activity for 30 days is deleted with its subagent chats and transcript; activity on day 29 keeps it; a row removed 31 days ago is deleted (E101, E102).                                                    |
| 14  | `server/test/cell-restore.slow.test.ts` | A pull that lists a root without a row gets it in `deleted`; the brain drops the chat and its folder when idle. A new subagent chat that is not yet synced is not dropped (E109).                                                            |
| 15  | `server/test/session-messages.test.ts`  | For a synced chat, Ren's `session.messages` returns the same messages as the brain's Chat API, page by page (E108).                                                                                                                          |
| 16  | `chat/test/chat-session.test.ts`        | Access `starting`: the history comes from Ren. Access `ready`: the runtime switches to the brain and shows each message once (E108).                                                                                                         |
| 17  | `server/test/cell-restore.slow.test.ts` | A chat over 20 MB restores page by page; no request is over the body limit (INV-53).                                                                                                                                                         |
| 18  | live, skipped without `E2B_API_KEY`     | Replace a brain's sandbox, then open its chat: history, subagent chats and a shell call all work (asks the user first, README §7).                                                                                                           |

Edge cases from ren-v1 that these tests cover: INV-51 (4), INV-53 (17), INV-55 (1), INV-56 (1), INV-58 (12), INV-60 (14: the brain drops only what Ren names), INV-69 (2).
