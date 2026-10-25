# Piece G: Linear

Status: spec written. Decisions: CH21, CH40, CH46 (README §4). Evidence: `../ren-v1/docs/specs/ledgers/linear.md` (rows below), `ren-v1 packages/api/src/linear/`, Linear developer docs (`developers/agent-interaction`, `developers/agent-signals`).

## Goal

The Linear layer of `ChannelProvider`. Ren is a Linear agent: people mention it or delegate an issue to it, and talk to it in the issue's agent session.

## The Linear app

- One OAuth app, installed with `actor=app` and the scopes `read`, `write`, `app:mentionable`, `app:assignable` (row 30). Without `write` Linear refuses every activity (v1 `73d68b833`).
- Webhook categories: agent session events, and the app's revoke event (piece D rule 7; its exact name is checked at build).
- Webhook URL: `https://<ren>/channels/linear`. Install redirect: `https://<ren>/channels/linear/callback`.
- Config: `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`, read when the layer builds. The OAuth `state` is Ren's own, never signed with the webhook secret (row 3). A missing value turns Linear off; the server still starts (row 35).

## verify

1. The `linear-signature` header equals the HMAC-SHA256 hex of the raw body with the webhook secret, compared in constant time. A missing header fails (row 1).
2. `webhookTimestamp` more than 60 seconds from now fails (row 2).
3. Linear needs the HTTP answer within 5 seconds (Linear docs, "Session webhooks"). Piece A answers after one Postgres write.

## parse

| Input                                                 | Result                                             |
| ----------------------------------------------------- | -------------------------------------------------- |
| `AgentSessionEvent`, action `created`                 | `Event`                                            |
| `AgentSessionEvent`, action `prompted`, no signal     | `Event`                                            |
| `AgentSessionEvent`, action `prompted`, signal `stop` | `Stop` (below)                                     |
| the app's revoke event                                | the core removes the install (CH25), then `Ignore` |
| any other type or action; an empty `prompted` text    | `Ignore` (rows 4, 5, 8)                            |

Fields of the `Event`:

| Field     | Value                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eventId` | the `Linear-Delivery` header                                                                                                                                                                                                       |
| `install` | `organizationId` of the payload. An event whose `appUserId` is not the install's app user is ignored (row 6).                                                                                                                      |
| `place`   | `{ id: <project id or "none">, kind: "project" }`; filled in the run (below)                                                                                                                                                       |
| `thread`  | `{ id: <agentSession.id>, url }`: the agent session URL, else the issue URL; only `https` on `linear.app` with no user, password or port (row 18)                                                                                  |
| `sender`  | `created`: `agentSession.creator`; `prompted`: `agentActivity.user`. `accountId` is the Linear user id, `email` from the payload (rows 9, 10)                                                                                      |
| `text`    | `created`: the comment that mentioned Ren (`agentSession.comment.body`), or for a delegation with no comment "You were assigned this issue." (row 7). `prompted`: `agentActivity.body`, else `agentActivity.content.body` (row 8). |

## Place and context (in the run)

The place needs one call to Linear, so it runs in the `ChannelEvent` run, before `ChannelRoute.resolve`, not in `parse` (piece A rule 2). This adds `ChannelProvider.locate(install, event)` → `Event`, an optional step that piece A's run calls first.

1. `locate` reads the issue's project with the install token. An issue with no project, or a failed read, gives the place `none`, which has no mapping, so it goes to the default space (rows 13, 14; CH26).
2. `Session.Channel.context` for `created` is Linear's `promptContext` (issue, comments, guidance). For `prompted` it is empty: the session already holds the earlier turns.

## Stop

`Stop` is a new `Parsed` case: `{ _tag: "Stop", install, thread }`. Linear says the agent must stop at once and then send a final activity (Linear docs, "Signals").

1. The core finds the thread's session and calls `brain.interrupt(sessionId)`, a new `BrainApi` endpoint (`cell` serves it with the harness's existing interrupt of the Chat API).
2. Then it posts a `response` activity: "Stopped."
3. No turn starts for the stop message.

## send

1. `agentActivityCreate` with `{ type: "response", body }` on the thread's agent session (row 21). `success: false` is an error (row 28).
2. A missing or dead token gives `Rejected` (row 29). A deleted agent session gives `PlaceGone`.

## progress

| Status     | Call                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `received` | `agentSessionUpdate` sets `externalUrls` to `[{ label: "Open in Ren", url }]`; then a `thought` "Working on it…" (row 19) |
| `todos`    | `agentSessionUpdate` sets `plan` to the full list: `pending`, `inProgress`, `completed`, `canceled`                       |
| `thought`  | `thought` activity with the finished reasoning text (row 24)                                                              |
| `tool`     | `action` activity: `action` = tool name, `parameter` = input summary, `result` = output summary (row 25)                  |
| `done`     | nothing; the `response` closes the session                                                                                |
| `failed`   | `error` activity with piece E's text (row 23)                                                                             |

A transport failure of a `thought` or `action` reaches the caller, which tries again with the next batch (row 27).

## Refusals

The `unlinked` refusal (piece C) is an `elicitation` activity with signal `auth` and `signalMetadata.url` = the Settings page where the person links an account. Linear shows its own "Link account" button. Other refusals are `error` activities.

## Install (piece D)

1. The token exchange returns an access token and a refresh token. Ren reads the app user id, the workspace id and the workspace name (`viewer`, `organization`) (row 31).
2. The access token lives about 24 hours; the credential refresh sweep renews it (CH21).
3. `places` lists the workspace's projects, with paging, sorted by name (row 33 had no paging).

## Edge cases

| #   | Case                                                  | Rule                                               | Row / source     |
| --- | ----------------------------------------------------- | -------------------------------------------------- | ---------------- |
| 1   | No activity within 10 s marks Ren unresponsive.       | `received` is the first run step (piece E rule 3). | 19, 20           |
| 2   | A delegation with an empty comment.                   | A fixed text (above).                              | 7                |
| 3   | An automation creates the session (no creator email). | The fallback user (piece C).                       | 11               |
| 4   | The issue has no project.                             | The default space.                                 | 13               |
| 5   | The person clicks "Send stop request".                | `brain.interrupt`, then "Stopped."                 | Linear "Signals" |
| 6   | An event older than 60 s.                             | Refused.                                           | 2                |

## Tests

1. A bad signature, a missing header and an old `webhookTimestamp` are refused.
2. `created` gives an `Event` with the comment text and the creator's email; an empty delegation gives the fixed text.
3. `prompted` gives an `Event` from `agentActivity.body`; an empty one gives `Ignore`.
4. A `stop` signal interrupts the session's turn and posts "Stopped."; no turn starts.
5. `locate` gives the issue's project; a project-less issue gives `none`.
6. `received` sets `externalUrls` and posts the thought.
7. `todos` replaces the whole plan.
8. A `success: false` answer is an error.
9. `unlinked` posts an elicitation with the `auth` signal.
10. The revoke event removes the install.
