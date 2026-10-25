# Piece C: identity and access

Status: spec written. Decisions: CH11, CH12, CH13, CH14, CH15, CH17, CH18 (README §4).

## Goal

For each message, Ren knows which Ren user wrote it and whether that user may run a turn in the mapped space. A person who signs in to Ren with Slack or GitHub is known in that provider at once. Others are found by email. A sender that Ren cannot use runs as the mapping's fallback user, or is refused when the mapping turns the fallback off.

Not in this piece:

- The mapping (place → space, agent, fallback user), the General space and the installs: piece D.
- The bot install that follows "Sign in with Slack", and the onboarding after it (CH19): piece D.
- The text of a refusal notice: piece E.
- Credentials and app profiles: a channel session loads them as any session of its space (CH15). Nothing here changes them.

## Model

```
 ┌───────────────────┐  resolve(event)      ┌──────────────────────┐  find(provider, install, account)   ┌──────────────────────────┐
 │                   │ ───────────────────▶ │                      │ ──────────────────────────────────▶ │                          │
 │  ChannelEvent run │                      │  ChannelRoute        │ ◀────────────────────────────────── │  ChannelIdentity         │
 │  (piece A)        │ ◀─────────────────── │  1 mapping (D)       │  Ren user, or none                  │  1 Better Auth account   │
 │                   │  Route, or Refused   │  2 sender            │                                     │  2 channel_account email │
 └───────────────────┘                      │  3 space member?     │                                     │  3 provider email lookup │
                                            │  4 fallback user     │                                     └──────────────────────────┘
                                            └──────────────────────┘
```

Where each link comes from:

| Provider | Link (wins)                                                                  | Email fallback                                                                                 |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Slack    | Better Auth `account`, `providerId = "slack"`, `accountId = "<team>:<user>"` | `users.info` of the user, with the install's bot token (scope `users:read.email`)              |
| GitHub   | Better Auth `account`, `providerId = "github"`, `accountId = <numeric id>`   | the public email of the login, `GET /users/{login}`, with the installation token               |
| Linear   | none                                                                         | the payload: `agentSession.creator.email` (`created`), `agentActivity.user.email` (`prompted`) |

## Sign-in

Better Auth 1.7.7 gives both providers (`@better-auth/core` `social-providers/slack.mjs`, `github.mjs`).

| Flow                | Steps                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in with Slack  | OpenID sign-in (`openid`, `email`, `profile`) → Better Auth creates or finds the user → the app's continue page asks Ren for the install state of the person's team → `install_required` redirects to the bot install at once (piece D). Two consent screens, as v1. |
| Sign in with GitHub | The GitHub App asks for user authorization during installation. One consent installs the App (piece D) and returns a user `code`; Better Auth signs the person in with the App's client id. A person who only signs in, with no install, uses the same provider.     |
| Link from Settings  | A signed-in person clicks "Connect Slack" or "Connect GitHub". Better Auth `linkSocial` adds the `account` row to that user, whatever the provider's email.                                                                                                          |

Rules:

1. The Slack provider maps the account id to `<team>:<user>`, from the ID token claims `https://slack.com/team_id` and `https://slack.com/user_id`. Better Auth's default subject is the user id alone (`social-providers/slack.mjs:11`); Slack user ids are unique per workspace only (v1 `41f428fb5`).
2. The GitHub App has the account permission "Email addresses: read". Without it GitHub gives no email and Better Auth cannot create the user (`social-providers/github.mjs:71`).
3. Automatic account linking by email (`accountLinking.trustedProviders`, `server/better-auth.ts:223`) adds `slack` and `github`, as v1 did for Slack (`ren-v1 auth/auth.ts:139`). A provider email that differs from the Ren email gives a new user; the person links from Settings instead.
4. The GitHub user sign-in of the credentials spec (`owner-access.md` target `{ kind: "github" }`, credential `GITHUB`) and "Sign in with GitHub" use the same GitHub App. A person who connects the credential also gets the `account` row (CH12).
5. A new user from either sign-in gets a default organization as today (`server/default-organization.ts`), unless an invitation waits.

## Resolve

`ChannelRoute.resolve(event)` (piece A interface) runs these steps for each message:

| Step | Does                                                                                                                                                                              | Result                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1    | Mapping of the place, else the General space (piece D): `spaceId`, `agentId`, `fallback`.                                                                                         | —                                  |
| 2    | `ChannelIdentity.find(provider, install, account)`: a Better Auth `account` row; else a `channel_account` row checked in the last 24 h; else the provider's email lookup, stored. | Ren user, or none                  |
| 3    | The user is an active member of the space (`space_member`, not archived).                                                                                                         | `senderUserId` = that user         |
| 4    | Step 2 or 3 failed, the mapping's fallback is on, and the fallback user is an active member of the space.                                                                         | `senderUserId` = the fallback user |
| 5    | Otherwise.                                                                                                                                                                        | `Refused { reason }`               |

`reason` is `unlinked` (no Ren user), `not_member` (a Ren user outside the space) or `fallback_gone` (the fallback user left the space).

Rules:

1. Every message is checked against its own sender. The session's `created_by` is the user of the first message (piece A, step 5).
2. `Session.Sender.userId` is the resolved user or the fallback user. The prompt also names the provider sender (name and handle; piece B), so the agent knows who spoke.
3. An email match counts only for a user who is a member of the install's organization.
4. When the email lookup fails (the provider is down), a stored `channel_account` row is used, even if older than 24 h.
5. A refusal sends one notice to the thread: the reason and the address of the Settings page where the person links an account (piece E text; v1 `301a65f13`).
6. A Linear event from an automation has no creator email, so it uses the fallback user.

## Contract changes

### Schema

`Channel.Event.sender` gains `email?: string`. Linear's `parse` fills it from the payload.

### Database

Table `channel_account` (email matches only, CH13):

| Column            | Type        | Notes                                       |
| ----------------- | ----------- | ------------------------------------------- |
| `id`              | text        | prefix `cha`                                |
| `organization_id` | text        |                                             |
| `provider`        | text        | `Channel.Provider`                          |
| `install`         | text        | the provider's workspace id; `*` for GitHub |
| `account`         | text        | the provider's user id                      |
| `user_id`         | text        | references `user.id`, `on delete cascade`   |
| `checked_at`      | timestamptz | the time of the last email lookup           |

Unique index `(organization_id, provider, install, account)`.

### Server

- `better-auth.ts`: add the `slack` and `github` social providers (CH17), the Slack account id mapping (rule 1) and the two trusted providers (rule 3). Config: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`. A missing pair turns that provider off; it does not stop the server (v1 crashed at boot: linear ledger row 35).
- Run `bun run generate` after the Better Auth change.

### App

- The sign-in page shows "Sign in with Slack" and "Sign in with GitHub" when the server has them.
- Settings shows "Connect Slack" and "Connect GitHub" for a signed-in person, and the linked account (team and user name, GitHub login).

## Services and layers

| Service                   | Package | Does                                                                                                                            | Layers       | Chosen by            |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------- |
| `ChannelIdentity.Service` | `core`  | `find(provider, install, account, email?)` → `Option<UserID>`. Reads `account`, then `channel_account`, then asks the provider. | one          | `server/src/main.ts` |
| `ChannelRoute.Service`    | `core`  | Steps 1 to 5 of Resolve. Step 1 is piece D.                                                                                     | one          | `server/src/main.ts` |
| `ChannelProvider` (A)     | `core`  | Adds `email(install, account)` → `Option<string>`, error `Unavailable`. Linear returns none; it gives the email in the event.   | per provider | —                    |

## Lifecycle states

| State                                       | What happens                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A user leaves the space                     | Their next message fails step 3; it runs as the fallback user or is refused. A stored run follows CH8. |
| The fallback user leaves the space          | `fallback_gone`; the notice asks to update the mapping.                                                |
| A user is deleted                           | Their `account` and `channel_account` rows go with them.                                               |
| A person changes their Slack email          | The `channel_account` row is checked again after 24 h. A sign-in link does not depend on email.        |
| The provider is down during an email lookup | A stored row is used; with no row, the sender is unknown (fallback or refusal).                        |

## Edge cases

| #   | Case                                                          | Rule                                                                | Source                           |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| 1   | The same Slack user id in two workspaces.                     | Account id `<team>:<user>`; `channel_account` keys on the install.  | `41f428fb5`                      |
| 2   | A GitHub user with a private email.                           | Found by the sign-in link; no link and no email gives the fallback. | github ledger row 23             |
| 3   | A Ren user who is not in the space, with a fallback user set. | Runs as the fallback user.                                          | `896b8e484`                      |
| 4   | Linear used the mapping's fixed user, not the author.         | The author's email first.                                           | `c723ebac8`                      |
| 5   | A stranger comments on a public repository.                   | The mapping starts with the fallback off (CH14), so a refusal.      | CH14                             |
| 6   | An email that matches a user of another organization.         | No match.                                                           | —                                |
| 7   | A Slack sign-in whose email differs from the Google account.  | A new user; the person links from Settings instead.                 | rule 3                           |
| 8   | Two people write in one thread.                               | Each message is checked alone; `created_by` stays the first.        | —                                |
| 9   | A GitHub App with no email permission.                        | Sign-in fails; the App needs "Email addresses: read".               | `social-providers/github.mjs:71` |

## Tests

Core tests use real Postgres and a test `ChannelProvider` item. Server tests cover the Better Auth providers.

1. A Better Auth `account` row wins over an email match.
2. A Slack email match of a space member gives that user and stores a `channel_account` row.
3. A `channel_account` row older than 24 h is looked up again. When the provider is down, the stored row is used.
4. An email of a user in another organization gives no match.
5. An unknown sender with the fallback on runs as the fallback user.
6. An unknown sender with the fallback off is refused with `unlinked`, with one notice.
7. A Ren user outside the space runs as the fallback user when it is on, and is refused with `not_member` when it is off.
8. A fallback user removed from the space gives `fallback_gone`.
9. The same Slack user id in two workspaces does not match across them.
10. A Linear payload email gives that user; a Linear event with no email runs as the fallback user.
11. Sign in with GitHub stores the numeric id; a comment from that id resolves to the user with a private email.
12. A second sender in a thread is checked alone; `created_by` stays the first sender.
13. Sign in with Slack stores the account id as `<team>:<user>`.
14. A server with no Slack config starts, and the Slack sign-in is off.
