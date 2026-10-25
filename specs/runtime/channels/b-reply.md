# Piece B: context in, reply out

Status: spec written. Decisions: CH33, CH34, CH35, CH36, CH37, CH38 (README §4). Depends on the Ren MCP (`specs/tasks.md:164`).

## Goal

The agent gets each channel message with who wrote it, where, and the earlier messages of the thread. The transcript shows the person's words with a clean header. The agent answers with one tool, `channel_reply`, and Ren posts the answer in the thread. A turn that ends without an answer gets one reminder.

Not in this piece:

- 👀 and other first signs of life, Slack task cards, Linear thoughts, failure notices: piece E.
- Provider formatting (Slack blocks, Linear code blocks, GitHub comment paths) and the context window rules of each provider: pieces F, G, H.
- The Ren MCP server itself: its own spec. This piece adds one tool to it.
- How the app draws the header and the "Sent on Slack" row: piece J.

## Model

```
 inbound (piece A run)
 ┌──────────────────────────┐  SessionRunner.send({ prompt.text, channel })   ┌──────────────────────────┐  each model call          ┌──────────────────────────┐
 │                          │  channel = { provider, place, thread url,       │                          │  Ren plugin `context`     │                          │
 │  ChannelEvent run        │            sender, handle, context }            │  OpenCode user message   │  hook adds header and     │  model input             │
 │                          │ ──────────────────────────────────────────────▶ │  text + metadata.channel │  context above the text   │                          │
 └──────────────────────────┘                                                  └──────────────────────────┘ ────────────────────────▶ └──────────────────────────┘

 outbound
 ┌──────────────────────────┐  channel_reply({ text })                        ┌──────────────────────────┐  provider.send(install,   ┌──────────────────────────┐
 │                          │  Ren MCP token names the session                │                          │  thread, text)            │                          │
 │  agent (root session)    │ ──────────────────────────────────────────────▶ │  ChannelReply            │ ────────────────────────▶ │  Slack, Linear, GitHub   │
 │                          │ ◀────────────────────────────────────────────── │                          │                           │                          │
 └──────────────────────────┘  "Sent" or an error                             └──────────────────────────┘                           └──────────────────────────┘

 reminder
 session sync: turn ended ─▶ no channel_reply since the last channel message? ─▶ insert channel_reminder(message id)
                          ─▶ inserted? ─▶ Brains.send({ kind: "synthetic", text: "Reply with channel_reply …" })
```

## Contract changes

### Schema

- `Session.Channel` (new): `{ provider: Channel.Provider, place: string, threadUrl?: string, sender: string, handle?: string, context?: string }`. `context` holds at most 12,000 characters.
- `Session.SendInput` and `Session.InitialMessage` gain `channel?: Session.Channel` and `kind: "user" | "synthetic"` (default `"user"`). A synthetic message has no `channel` and no files.
- `SessionMessage.User` gains `channel?: Session.Channel` (`schema/src/session/message.ts:124`), read from OpenCode's `metadata.channel` by `@ren/opencode-transcript`.

### Brain API and cell

- `brain.send` takes the new fields. The cell puts `channel` into the prompt's `metadata` next to `userID` and `userName` (`cell/src/harness/opencode/chat.ts:167`).
- A `synthetic` send uses OpenCode's synthetic inbox item (`@opencode/schema` `session-inbox.ts:21`), with `description` "Reminder: reply in the thread" and `metadata.source = "channel"`. The skip of a known message id (`chat.ts:61`) applies to it too.
- Ren's OpenCode plugin adds a `context` hook (as `cell/src/harness/opencode/plugin.ts:266`). For each model message whose metadata has `channel`, it puts one text part before the person's text:

```
Slack #eng · Ana (@ana) · https://acme.slack.com/archives/C07/p1712…
Earlier in the thread:
[Bob] the deploy failed at 10:02
---
```

### Database

Table `channel_reminder`: `message_id` (primary key: the channel message that is owed a reply), `session_id`, `created_at`. One insert per reminder; `on conflict do nothing` decides who sends.

`channel_thread` (piece A) gains `last_message_at`: the time of the latest channel message that the thread sent into the session.

### Ren MCP

One tool:

| Tool            | Input                      | Output              |
| --------------- | -------------------------- | ------------------- |
| `channel_reply` | `{ text: NonEmptyString }` | `"Sent to <place>"` |

Its description says: "Answer the person in the Slack, Linear or GitHub thread this chat came from. Plain text in the chat is not sent."

## Services and layers

| Service                   | Package | Does                                                                           | Layers      | Chosen by            |
| ------------------------- | ------- | ------------------------------------------------------------------------------ | ----------- | -------------------- |
| `ChannelReply.Service`    | `core`  | `reply(sessionId, text)`: checks, picks the thread, calls `send`, retries.     | one         | `server/src/main.ts` |
| `ChannelReminder.Service` | `core`  | On a turn end from session sync: decides, claims, sends the synthetic message. | one         | `server/src/main.ts` |
| `ChannelProvider` (A)     | `core`  | Adds `send(install, thread, text)` → `Effect<void, PlaceGone                   | Unavailable | Rejected>`.          | per provider | —   |

## Rules

### Inbound

1. The person's words are the message text. Nothing is added to the text.
2. `context` holds the thread messages that the provider gives for this message (pieces F, G, H choose the window). Over 12,000 characters, the oldest lines drop first and the context starts with `[earlier messages omitted]` (slack ledger row 34).
3. The model sees the header and the context on every model call, also after a restart, because they are stored with the message.

### Reply

4. `channel_reply` from a child session (`agent_session.parent_id` set) is refused: "Only the main agent replies in the thread." (v1 `opencode-plugin/src/tools/channel-guard.ts`).
5. The thread is the session's `channel_thread` with the latest `last_message_at`. With no thread the call is refused: "This chat has no thread to reply to." (channels ledger row 76).
6. `PlaceGone` (Slack `channel_not_found`, `not_in_channel`, `is_archived`; a deleted Linear session or GitHub issue) returns an error to the agent and removes the place's mapping (channels ledger row 79).
7. `Unavailable` (5xx, timeout) is retried 3 times with backoff, then returned to the agent as an error. `Rejected` (4xx other than gone) is returned at once with the provider's message.
8. Text only. Files wait for a Brain API file read (CH38).
9. GitHub replies are comments posted with the installation token, so they show as the app (CH35).

### Reminder

10. The trigger is a turn end of a root session, read from session sync.
11. Ren sends a reminder only when the latest human message of the session is a channel message and no `channel_reply` call finished after it.
12. The claim is the insert into `channel_reminder` keyed by that message id. Two turn ends at the same time send one reminder.
13. A reminder is synthetic, so it is not a human message: the turn that it starts can never earn a second reminder (rule 11).
14. A session whose latest human message came from the app gets no reminder.

## Lifecycle states

| State                         | What happens                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Brain asleep at reminder time | `Brains.send` wakes it (piece A rules).                                                        |
| Mid-turn                      | The reminder waits for the turn end; a steered message (CH7) moves "the last channel message". |
| Ren down at a turn end        | Session sync catches up after Ren returns; the reminder runs then.                             |
| Ren MCP not built             | Messages arrive and turns run; nothing is posted (CH33).                                       |

## Edge cases

| #   | Case                                           | Rule                                 | Source                 |
| --- | ---------------------------------------------- | ------------------------------------ | ---------------------- |
| 1   | The agent writes the answer as plain text.     | One reminder (rule 11).              | channels ledger row 86 |
| 2   | Both the agent and its subagent try to answer. | The subagent is refused (rule 4).    | `channel-guard.ts`     |
| 3   | Two threads of one session.                    | The latest channel message's thread. | channels ledger row 36 |
| 4   | Two turn-end events at the same time.          | One reminder (rule 12).              | channels ledger row 86 |
| 5   | The channel was archived.                      | Error, mapping removed (rule 6).     | slack ledger row 56    |
| 6   | A long thread.                                 | Context cut at 12,000 characters.    | slack ledger row 34    |

## Tests

1. The reply goes to the thread of the latest channel message.
2. A child session's call is refused.
3. A session with no thread is refused.
4. `PlaceGone` returns an error and removes the mapping.
5. `Unavailable` retries 3 times, then returns an error.
6. A turn end with no reply sends one synthetic reminder; two turn ends at the same time send one.
7. The turn that a reminder starts sends no second reminder.
8. A session whose latest human message came from the app gets no reminder.
9. The model input has the header and the context; the stored text is the person's words.
10. A context over 12,000 characters drops its oldest lines and starts with `[earlier messages omitted]`.
11. A synthetic send shows in the transcript as a notice, not as a user message.
