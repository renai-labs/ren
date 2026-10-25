# Piece E: turns with no human, progress and notices

Status: spec written. Decisions: CH39, CH40, CH41 (README §4).

## Goal

A turn that a channel starts never waits for a click that nobody can give. The person in the provider sees that Ren got the message, sees the work move, and sees the end. A failure reaches the thread as one plain sentence with a link.

Not in this piece:

- The reply and the reminder: piece B.
- Provider details: the exact Slack stream calls, Linear activity shapes, GitHub reaction calls: pieces F, G, H.

## Model

```
 ┌──────────────────┐  received            ┌──────────────────┐
 │  ChannelEvent    │ ───────────────────▶ │                  │
 │  run, step 0     │  👀 / "Working on    │                  │
 └──────────────────┘   it…"               │                  │
                                           │  provider        │
 ┌──────────────────┐  todos, thought,     │  progress(       │
 │  channel-progress│  tool                │    install,      │
 │  run per session │ ───────────────────▶ │    thread,       │
 │  cursor on sync  │                      │    status)       │
 │  rows            │  done / failed       │                  │
 │                  │ ───────────────────▶ │                  │
 └──────────────────┘                      └──────────────────┘
          ▲
          │ after session sync stores rows of a session that has a channel thread
 ┌────────┴─────────┐
 │  SessionSync     │
 └──────────────────┘
```

## Contract changes

### Core

- `ChannelProvider` (piece A) adds `progress(install, thread, status, handle)` → `Effect<Option<Handle>, Unavailable>`. A provider without a status ignores it.
- `Channel.Progress` (schema):

```ts
Progress =
  | { _tag: "received", message: string }                         // the provider's message id
  | { _tag: "todos", items: ReadonlyArray<{ id: string, title: string, status: "pending" | "in_progress" | "complete" | "error" }> }
  | { _tag: "thought", text: string }
  | { _tag: "tool", name: string, input: string, output: string }
  | { _tag: "done" }
  | { _tag: "failed", reason: Channel.FailureReason }
```

- `Channel.FailureReason`: `unlinked`, `not_member`, `fallback_gone`, `brain_failed`, `model_busy`, `context_too_long`, `unknown`.
- `SessionRunner.create` for a channel session passes `interactive: false` (CH39).

### Database

- `channel_thread` (piece A) gains `progress` (jsonb, null): `{ stream?: string, closed: boolean }`, the live Slack card handle; and `received_message` (text, null): the provider message that the reactions go on.
- Table `channel_progress_cursor`: `session_id` (primary key), `cursor` (the last sync row sent), `updated_at`.

## Rules

### No human

1. A session that a channel creates has `interactive: false` for life. An `ask` becomes a deny with "… needs approval, and no one can approve it in this session." (`brain/src/settings.ts:166-170`). The `question` tool is removed (`cell/src/harness/opencode/harness.ts:74`).
2. The behaviour skill (pieces F, G, H) tells the agent to ask in words with `channel_reply` and to tell the person when an action was denied.

### Progress

3. `received` is the first step of the `ChannelEvent` run, before `ChannelRoute.resolve`, so Linear gets an activity within about 10 seconds, also for a sender who is then refused (linear ledger rows 19, 20). A failed `received` is logged and never stops the run (github ledger row 30).
4. After session sync stores rows for a session that has a `channel_thread`, Ren ensures the run `channel-progress:<sessionId>`. The run reads the rows after its cursor, maps them to statuses, calls `progress`, and moves the cursor after each successful call. A failed call leaves the cursor; the next batch tries again (channels ledger rows 55, 58).
5. Progress goes to the thread of the session's latest channel message. A turn that a message from the app started sends no progress (channels ledger row 37).
6. `thought` is sent when a reasoning part is finished; growing text is sent once (channels ledger row 56). `tool` is sent when a tool call is finished. `channel_reply` and `todowrite` are never sent as `tool` (channels ledger row 57; linear ledger row 25).
7. `todos` comes from the todo list of the turn. The ids are `todo_<position>`; a title is cut at 256 characters; an empty list opens nothing (slack ledger rows 64, 65).
8. The Slack card handle: the first `todos` claims `progress.stream` with a conditional update. A server that loses the claim stops its own stream. `done` or `failed` sets `closed` before it stops the stream, so a late `todos` opens nothing. The next `received` on the thread clears the handle (slack ledger rows 66-69).
9. End markers:

| Status   | Slack                    | Linear                   | GitHub            |
| -------- | ------------------------ | ------------------------ | ----------------- |
| received | 👀 on the message        | thought "Working on it…" | 👀 on the comment |
| done     | close the card; 👀 stays | —                        | 👀 → 🚀           |
| failed   | close the card; 👀 → ❌  | error activity           | 👀 → 😕           |

The Slack reply itself means "done", so 👀 stays on success (slack ledger row 61).

### Notices

10. A notice is sent by Ren with `send` (piece B), never by the agent. Its text is fixed per reason:

| Reason             | Text                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| `unlinked`         | "I don't know who you are in Ren yet. Link your account: <Settings link>"        |
| `not_member`       | "You're not in the Ren space for this channel. Ask a member to add you."         |
| `fallback_gone`    | "This channel's fallback user left the space. Update it in Ren: <mapping link>"  |
| `brain_failed`     | "Ren could not start. <Open in Ren>"                                             |
| `model_busy`       | "The model is busy. Try again in a minute. <Open in Ren>"                        |
| `context_too_long` | "This conversation is too long for the model. Start a new thread. <Open in Ren>" |
| `unknown`          | "Ren hit a problem and could not finish. <Open in Ren>"                          |

11. The reason comes from a typed error or from the session's error code, never from matching error text (channels ledger row 16). Raw error text never reaches a provider.
12. A failed notice is logged. It never hides the original failure (channels ledger row 15).
13. "Open in Ren" is the app address of the session. A refusal has no session; its link is the Settings page of piece D.

## Services and layers

| Service                   | Package | Does                                                                         | Layers       | Chosen by            |
| ------------------------- | ------- | ---------------------------------------------------------------------------- | ------------ | -------------------- |
| `ChannelProgress.Service` | `core`  | The `channel-progress` run: cursor, mapping of sync rows to statuses, calls. | one          | `server/src/main.ts` |
| `ChannelNotice.Service`   | `core`  | `notice(thread, reason, links)`: the fixed text, then `send`.                | one          | `server/src/main.ts` |
| `ChannelProvider` (A)     | `core`  | Adds `progress`.                                                             | per provider | —                    |

## Lifecycle states

| State                 | What happens                                                          |
| --------------------- | --------------------------------------------------------------------- |
| Brain asleep, waking  | `received` is sent by Ren before any brain call.                      |
| Mid-turn              | Sync rows arrive while the turn runs; the card and activities update. |
| Ren restarts mid-turn | The cursor is in Postgres; the run resumes and sends each step once.  |
| Brain `failed`        | `failed` with `brain_failed`, and one notice.                         |
| Turn needs approval   | The ask is denied at once (rule 1); the turn goes on.                 |

## Edge cases

| #   | Case                                                  | Rule                                      | Source                    |
| --- | ----------------------------------------------------- | ----------------------------------------- | ------------------------- |
| 1   | Linear marks the agent unresponsive after about 10 s. | `received` is the first step (rule 3).    | linear ledger rows 19, 20 |
| 2   | Two servers open a Slack card at the same time.       | One claim wins; the loser stops (rule 8). | slack ledger row 68       |
| 3   | A todo update after the turn end.                     | `closed` blocks it (rule 8).              | slack ledger row 69       |
| 4   | The same sync batch arrives twice.                    | The cursor sends each step once.          | channels ledger row 55    |
| 5   | An error text with internal ids.                      | Fixed text only (rule 11).                | channels ledger row 16    |
| 6   | A subagent asks for approval.                         | Denied like the root (rule 1).            | `18b23b8a5`               |

## Tests

1. A channel session is created with `interactive: false`; an `ask` is denied with its message; the `question` tool is absent.
2. `received` is sent before the sender check, also for a refused sender.
3. A todo update opens one Slack card; two servers at the same time end with one card.
4. A todo update after `done` opens no card; the next `received` clears the handle.
5. A sync batch that arrives twice sends each Linear activity once; a failed call is sent with the next batch.
6. `channel_reply` and `todowrite` never appear as `tool`.
7. A turn started from the app sends no progress to the thread.
8. GitHub ends with 🚀 on `done` and 😕 on `failed`; Slack keeps 👀 on `done` and shows ❌ on `failed`.
9. A 429 from the model posts the `model_busy` text; the raw error does not reach the provider.
10. A notice that fails to send is logged, and the original failure stays.
