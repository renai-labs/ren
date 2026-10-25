# Piece F: Slack

Status: spec written. Decisions: CH17, CH19, CH24, CH27, CH44 (README §4). Evidence: `../ren-v1/docs/specs/ledgers/slack.md` (rows below), `ren-v1 packages/api/src/slack/`.

## Goal

The Slack layer of `ChannelProvider`. It turns Slack events into `Channel.Event`, reads files and context, posts replies and progress, and installs the bot.

## The Slack app

- One Slack app for Ren, with the Agent messaging experience (`agent_view`). The manifest never goes back to `assistant_view`, and Ren never calls `assistant.threads.setStatus` (slack ledger row 23).
- Bot scopes: v1's list without `commands` and `assistant:write` (`d-installs.md` rule 1): `app_mentions:read`, `channels:history`, `channels:join`, `channels:read`, `chat:write`, `chat:write.public`, `files:read`, `files:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `im:write`, `reactions:read`, `reactions:write`, `users:read`, `users:read.email`, `users.profile:read`.
- Event subscriptions: `app_mention`, `message.im`, `app_uninstalled`, `tokens_revoked`.
- Request URL: `https://<ren>/channels/slack` (piece A). Install redirect: `https://<ren>/channels/slack/callback` (piece D).
- Sign in with Slack uses OpenID (`openid`, `email`, `profile`) on the same app (piece C).
- Config: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, read when the layer builds. A missing value turns Slack off; the server still starts.

## verify

1. `X-Slack-Signature` equals `v0=` + HMAC-SHA256 hex of `v0:<X-Slack-Request-Timestamp>:<raw body>`, with the signing secret, compared in constant time (rows 1, 3).
2. A timestamp more than 5 minutes from now fails (row 2).

## parse

| Input                                                                                   | Result                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `url_verification`                                                                      | `Handshake { challenge }` (row 5)                  |
| `app_uninstalled`, `tokens_revoked`                                                     | the core removes the install (CH25), then `Ignore` |
| `app_mention`                                                                           | `Event`, place kind `channel`                      |
| `message` with `channel_type: im`, no subtype or `file_share`                           | `Event`, place kind `dm` (rows 11, 13)             |
| a message from a bot, from Ren's bot user, or with another subtype (edit, join, delete) | `Ignore` (row 12)                                  |
| a channel message without a mention                                                     | `Ignore` (CH44)                                    |

Fields of the `Event`:

| Field     | Value                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `eventId` | `event_id` of the envelope. A retry (`X-Slack-Retry-Num`) has the same id.                                                           |
| `install` | the team of the install: `authorizations[0].team_id`, else `team_id`. In a shared channel the event's team can be another workspace. |
| `place`   | `{ id: <channel>, kind: "channel"                                                                                                    | "dm" }` |
| `thread`  | `{ id: "<channel>:<thread_ts or ts>", url }`. A top-level DM starts a new thread (row 14).                                           |
| `sender`  | `{ accountId: "<team>:<user>", name, handle }` (CH18)                                                                                |
| `text`    | the normalized text (below), without the mention of Ren                                                                              |
| `files`   | references: `url_private_download`, name, mime, size (row 51)                                                                        |

A message that opens with `run` is plain prose, not an agent choice (row 17). There is no per-message agent choice; the mapping chooses the agent.

## Text

Kept from v1 (`slack/message/`, rows 38-49):

1. `rich_text` blocks are the first source; the plain `text` is used only when the blocks give nothing.
2. Bold, italic, strike, code, links, ordered and bullet lists with indent, quotes and fenced code with its language are kept as Markdown.
3. Other blocks (section, markdown, image, video, header, context) give their text through a generic walk.
4. Slack tokens decode: `<@U…>` to `@name`, `<#C…>` to `#name`, links to Markdown links. `&lt;`, `&gt;`, `&amp;` unescape after the tokens decode. Code stays as written.
5. Emoji, dates, user groups and `@here` render as text.
6. A forward, an unfurl and a message link fold into an indented block with a source label.
7. Files become `[file: name (mime)]` lines, without duplicates by file id.

## Context (in the run, not in `parse`)

`Session.Channel.context` (piece B) for a mention in a thread:

1. The thread messages between Ren's previous mention and this one; the whole thread for the first mention. Ren's own messages are left out (rows 31, 32).
2. Each line is `[author] text`; empty bodies drop (row 33).
3. Limits: 50 messages, 12,000 characters, 10 pages of 200 replies, 50 name lookups; older lines drop first with `[earlier messages omitted]` (row 34).
4. A failed read gives the message alone (row 35). Unknown ids show as the id (row 37).

## Files

`fetchFile` downloads with `Authorization: Bearer <bot token>` (row 51). Limits are piece A's (CH10).

## send

1. To the thread's channel and `thread_ts` (row 52).
2. Text of 11,000 characters or less goes as one `markdown` block, unchanged. Longer text goes as `mrkdwn` sections of at most 2,900 characters, cut at a paragraph break, then a line break, then a space. The fallback `text` is the `mrkdwn` form (rows 53-55).
3. `channel_not_found`, `not_in_channel`, `is_archived` give `PlaceGone` (piece B rule 6). An inactive install gives `Rejected`.

## progress

| Status     | Call                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `received` | `reactions.add` `eyes` on the message                                                                                                                                                                                                                                                                         |
| `todos`    | the first non-empty list opens `chat.startStream` in `plan` mode for the sender and team; each update sends the full list as `task_update` chunks with ids `todo_<position>` (rows 63-66). Status map: in progress stays; complete and completed give complete; error and cancelled give error; else pending. |
| `done`     | `chat.stopStream`; `eyes` stays                                                                                                                                                                                                                                                                               |
| `failed`   | `chat.stopStream`; `eyes` → `x`                                                                                                                                                                                                                                                                               |

`thought` and `tool` are ignored. The stream handle is piece E rule 8. A stream that fails to stop does not stop the reply (row 70).

## Install (piece D)

1. `oauth.v2.access` must return `access_token`, `bot_user_id`, `team.id`; the answer also gives `team.name`, `scope`, `authed_user.id` (row 77).
2. The authorize URL carries `client_id`, `scope`, `redirect_uri`, `state`, and the `team` hint after Sign in with Slack (row 76).
3. `places` lists public and private channels the bot can see: `conversations.list`, sorted by name, up to 25 pages of 200; a partial list is an error, not a short list (rows 81, 91).
4. `revoke` calls `auth.revoke`. `join` calls `conversations.join`.

## Edge cases

| #   | Case                                                  | Rule                                             | Row |
| --- | ----------------------------------------------------- | ------------------------------------------------ | --- |
| 1   | Slack sends the same event again after a slow answer. | Same `event_id`; one run (piece A).              | 6   |
| 2   | A DM with a file.                                     | `file_share` starts a turn.                      | 13  |
| 3   | The same user id in two workspaces.                   | `<team>:<user>` (CH18).                          | 25  |
| 4   | A shared channel from another workspace.              | The install comes from `authorizations`.         | —   |
| 5   | A very long reply.                                    | `mrkdwn` sections; one `markdown` block at most. | 54  |
| 6   | Two servers open a task card.                         | One wins (piece E).                              | 68  |

## Tests

1. A bad signature and an old timestamp are refused.
2. `url_verification` returns the challenge.
3. `app_mention` gives an `Event`; a channel message without a mention gives `Ignore`; a DM gives an `Event`.
4. A bot message, Ren's own message and an edit give `Ignore`; a `file_share` DM gives an `Event` with its files.
5. The thread id uses `thread_ts`, else `ts`.
6. The text cases of rows 38-49 (one table test).
7. The context window starts after Ren's previous mention, leaves out Ren's messages and keeps the limits.
8. A reply of 11,000 characters is one `markdown` block; a longer one is split at paragraph breaks.
9. `channel_not_found` gives `PlaceGone`.
10. `received` adds `eyes`; `failed` swaps it to `x`; `done` keeps it.
11. `app_uninstalled` removes the install.
