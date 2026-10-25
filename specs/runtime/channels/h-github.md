# Piece H: GitHub

Status: spec written. Decisions: CH12, CH17, CH29 to CH32, CH35, CH43, CH45 (README §4). Evidence: `../ren-v1/docs/specs/ledgers/github.md` (rows below), `ren-v1 packages/api/src/github/`.

## Goal

The GitHub layer of `ChannelProvider`. A mention of Ren on an issue or a pull request starts a turn. A repository can opt in to a review when a pull request is ready. A merge closes linked tasks.

## The GitHub App

- One GitHub App for Ren, with "Request user authorization (OAuth) during installation" on, and the account permission "Email addresses: read" (piece D rule 3).
- Repository permissions: contents read and write, issues read and write, pull requests read and write, metadata read.
- Webhook events: `issue_comment`, `pull_request_review_comment`, `pull_request`, `installation`.
- Webhook URL: `https://<ren>/channels/github`. Setup and callback URL: `https://<ren>/channels/github/callback`.
- Config: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_BOT_USER_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, or base64 of the PEM; row 42), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`. Read when the layer builds; a bad key stops the layer, not the server (row 43). A missing webhook secret turns GitHub off, so nothing runs unsigned (row 4).
- Every API call sends `Accept: application/vnd.github+json` and a fixed `X-GitHub-Api-Version`, checked against GitHub at build (row 44).

## verify

`X-Hub-Signature-256` equals `sha256=` + HMAC-SHA256 hex of the raw body, compared in constant time after a length check (rows 1-3).

## parse

| Input                                                                                 | Result                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ping`                                                                                | `Handshake {}` (row 5)                                                     |
| `installation`, action `deleted`                                                      | the core removes the install (CH25), then `Ignore`                         |
| `pull_request`, action `closed`, `merged: true`, from any sender                      | `Signal pull_request_merged` (piece I), read before the bot check (row 21) |
| a sender that is a bot: `sender.type = "Bot"`, or `sender.id` = the App's bot user id | `Ignore` (rows 8, 9)                                                       |
| `issue_comment` or `pull_request_review_comment`, action `created`, body mentions Ren | `Event`                                                                    |
| the same, action `edited`, when the earlier body (`changes.body.from`) had no mention | `Event`; an edit of a comment that already mentioned Ren is `Ignore`       |
| `pull_request`, action `opened` (not a draft) or `ready_for_review`                   | `Event` for the PR listener (below)                                        |
| anything else, or an event with no sender, installation or repository                 | `Ignore` with a reason (row 14)                                            |

A mention is `@<slug>` or `@<slug>[bot]`, in any letter case (row 10). The slug is config; the loop guard uses the bot user id, so a renamed App does not reopen the loop (row 8).

Fields of the `Event`:

| Field     | Value                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eventId` | the `X-GitHub-Delivery` header (row 7)                                                                                                                                                               |
| `install` | `installation.id`                                                                                                                                                                                    |
| `place`   | `{ id: <repository.id>, kind: "repository", name: <full_name> }`. The numeric id stays after a rename (row 15).                                                                                      |
| `thread`  | `{ id: "<repository.id>:<number>", url }`; an issue and a pull request share GitHub's number space (CH45). The URL is kept only for `https` on `github.com` with no user, password or port (row 56). |
| `sender`  | `{ accountId: <sender.id>, handle: <sender.login> }`. The actor is `sender`, not the comment author (row 17).                                                                                        |
| `text`    | the comment body; for the PR listener, the mapping's `prListenerPrompt` or "Review this pull request."                                                                                               |
| `files`   | none                                                                                                                                                                                                 |

## Context

`Session.Channel.context` holds the issue or pull request title, its state, the branch names for a pull request, and the triggering comment with its id, kind (`issue` or `review`) and author. It does not hold the rest of the discussion: one session per thread already holds what Ren saw, and the agent reads more with `gh` (row 19).

## PR listener

1. A mapping has `prListener` (default off) and `prListenerPrompt`, as `Channel.Declaration` already declares (`schema/src/channel.ts:16-19`). `channel_mapping` gains the two columns.
2. It runs on `opened` (not a draft) and `ready_for_review`. A push (`synchronize`) does not run it (row 20).
3. The sender is the pull request's author, through piece C. A refusal posts no comment, because nobody is waiting (v1).

## send

1. A thread started by a conversation comment, or by the PR listener, gets an issue comment: `POST /repos/{owner}/{repo}/issues/{number}/comments`.
2. A thread whose latest message was a diff-line comment gets a reply in that review thread: `POST /repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies` (row 31).
3. Comments use the installation token, so they show as the App (CH35). A non-2xx answer is a typed error with the status and the body (rows 27, 45); 404 or 410 on the issue gives `PlaceGone`.

## progress

| Status     | Call                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| `received` | `eyes` reaction on the triggering comment; for the PR listener, on the pull request |
| `done`     | remove `eyes`, add `rocket`                                                         |
| `failed`   | remove `eyes`, add `confused`                                                       |

Reactions use `issues/comments/{id}/reactions` or `pulls/comments/{id}/reactions` by the comment kind (row 31). A failed reaction is logged and never blocks the turn (row 30). Ren never edits a person's comment; v1's `<ins>` edit caused the reply loop (row 29). `todos`, `thought` and `tool` are ignored.

## Tokens (piece D)

1. Installation token: an App JWT (RS256, issued 60 s in the past, expires after 9 min; row 41), then `POST /app/installations/{id}/access_tokens`, which returns `token` and `expires_at` (row 40).
2. List calls read every page, 100 items at a time (row 46).
3. The user code exchange can answer 200 with an `error` field: that is a failure (row 47). After it, `GET /user` gives the numeric id, the login and the name; a failed read fails the sign-in (row 48).
4. A refresh error `bad_refresh_token`, `invalid_grant`, `unauthorized_client`, or HTTP 401 is fatal and deletes the person credential (row 49). A refresh answer without a lifetime counts as 8 hours (row 50).
5. `places` lists the installation's repositories (`GET /installation/repositories`, every page), with the `private` flag for CH14.

## Edge cases

| #   | Case                                                 | Rule                                         | Row    |
| --- | ---------------------------------------------------- | -------------------------------------------- | ------ |
| 1   | Ren's own comment mentions Ren.                      | The bot check by id ignores it.              | 8, 9   |
| 2   | The App is renamed.                                  | The loop guard uses the bot user id.         | 8      |
| 3   | A person edits a comment that already mentioned Ren. | `Ignore`.                                    | 12     |
| 4   | A diff-line comment.                                 | The reply goes to its review thread.         | 11, 31 |
| 5   | A bot merges the pull request.                       | The merge signal counts.                     | 21     |
| 6   | A delivery that GitHub sends again.                  | Same `X-GitHub-Delivery`; one run (piece A). | 7, 11  |
| 7   | A stranger mentions Ren on a public repository.      | The fallback is off there (CH14): a refusal. | 24     |

## Tests

1. A bad, missing, or other-secret signature is refused.
2. `ping` gives `Handshake`.
3. A mention on an issue and on a pull request each give an `Event` with thread `<repo id>:<number>`.
4. A bot sender, and a sender with the App's bot user id, give `Ignore`.
5. An `edited` comment gives an `Event` only when the earlier body had no mention.
6. A merged `closed` from a bot gives the signal; an unmerged `closed` gives `Ignore`.
7. The PR listener runs on `opened` (not a draft) and `ready_for_review`, not on `synchronize`, and only with `prListener` on.
8. A reply to a diff-line thread uses the `replies` path; other replies use issue comments.
9. `received` adds `eyes`; `done` swaps it for `rocket`; `failed` for `confused`.
10. The App JWT is issued 60 s in the past and expires within 10 minutes.
11. An exchange that answers 200 with `error` fails.
12. `installation` `deleted` removes the install.
