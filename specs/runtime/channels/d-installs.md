# Piece D: installs, mappings and GitHub tokens

Status: spec written. Decisions: CH16, CH19 to CH32 (README §4).

## Goal

An organization connects one Slack workspace, one Linear workspace and one GitHub installation. A person does it from "Sign in with Slack", "Sign in with GitHub", Settings → Channels, or the onboarding step after sign-up. Each place goes to a space: its mapping, the sender's own space for a Slack DM, or the default space. Every workload of a space reaches GitHub through `GITHUB_TOKEN=ren:GITHUB`, and the egress injects the right token.

Not in this piece:

- Who wrote a message, the fallback user and the account links: piece C.
- The reply, notices and the welcome DM text: pieces B and E.
- Provider details (event types, scopes per call): pieces F, G, H.
- The Settings → Channels screens: piece J. This piece names what they do.

## Model

```
 organization org_acme
 ├── channel_install  slack   T01 "Acme"          ── credential (org, sealed bot token)
 │     ├── channel_mapping  C07 #eng    → space sp_eng,   agent —,       fallback Ana (on)
 │     └── channel_mapping  C09 #sales  → space sp_sales, agent closer,  fallback —  (off)
 ├── channel_install  linear  lin_9 "Acme"        ── credential (org, sealed access + refresh token)
 │     └── channel_mapping  prj_4 "Web" → space sp_eng
 ├── channel_install  github  111 "acme"          ── no stored token; Ren mints from the App key
 │     └── channel_mapping  repo 8812 "acme/api" → space sp_eng
 └── settings  channels.defaultSpace = sp_general
```

Where a message goes (`ChannelRoute` step 1, piece C):

| Place                  | Space                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A place with a mapping | the mapping's space, agent and fallback                                                                                                           |
| A Slack DM             | the sender's oldest active space with the sender as its only member; else the default space (CH27)                                                |
| Any other place        | `channels.defaultSpace`; when it is archived, the oldest active space of the org (CH26). Agent `ren`, fallback on, fallback user = the installer. |

## Contract changes

### Database

Table `channel_install`:

| Column            | Type        | Notes                                                         |
| ----------------- | ----------- | ------------------------------------------------------------- |
| `id`              | text        | prefix `chi`                                                  |
| `organization_id` | text        |                                                               |
| `provider`        | text        | `Channel.Provider`                                            |
| `workspace`       | text        | Slack team id, Linear organization id, GitHub installation id |
| `name`            | text        | workspace name or GitHub account login, read at install       |
| `bot_user`        | text, null  | Slack bot user id, Linear app user id, GitHub App bot user id |
| `credential_id`   | text, null  | the org credential that holds the secret; null for GitHub     |
| `installed_by`    | text        | user id                                                       |
| `created_at`      | timestamptz |                                                               |

Unique `(provider, workspace)` (CH22). Unique `(organization_id, provider)` (CH30). `channel_thread.install` (piece A) and `channel_account.install` (piece C) reference `channel_install.id`.

Table `channel_mapping`:

| Column                     | Type        | Notes                                                                                      |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `id`                       | text        | prefix `chm`                                                                               |
| `install_id`               | text        | references `channel_install`, `on delete cascade`                                          |
| `place`                    | text        | Slack channel id, Linear project id, GitHub repository id (numeric, stable after a rename) |
| `place_name`               | text        | read at write time; the prompt uses it with no call                                        |
| `space_id`                 | text        | references `space`                                                                         |
| `agent_id`                 | text, null  | null runs `ren`                                                                            |
| `fallback_user_id`         | text, null  | piece C step 4                                                                             |
| `fallback`                 | boolean     | on by default; off by default for a public GitHub repository (CH14)                        |
| `created_by`               | text        |                                                                                            |
| `created_at`, `updated_at` | timestamptz |                                                                                            |

Unique `(install_id, place)`.

### Schema and settings

- `Settings`: an org key `channels.defaultSpace` (a `Space.ID`). Empty means the org's first space.
- `Channel.Install` and `Channel.Mapping` info shapes for the API. No secret in either.
- `Channel.Declaration` (`schema/src/channel.ts:11`) keeps its shape; `channels.yaml` writes `channel_mapping` rows through the same service. Bindings in `deploy.yaml` give the place id (`Channel.Target`).

### Protocol (public API)

| Operation                | Who                                    | Does                                                                     |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| `channel.install.start`  | any org member (CH20)                  | Returns the provider's install URL with a one-time `state`.              |
| `channel.install.list`   | any org member                         | The org's installs; no secret.                                           |
| `channel.install.remove` | the installer or an org admin          | Removes the install, its credential and its mappings.                    |
| `channel.place.list`     | any org member                         | The places an install reaches, sorted by name, with the current mapping. |
| `channel.mapping.set`    | a member of the target space           | Writes a mapping. The same request twice gives the same row.             |
| `channel.mapping.remove` | a member of the mapped space, or admin | Removes a mapping.                                                       |

`bun run generate` after the protocol change.

### Server routes

- `GET /channels/:provider/callback`: the install callback. `state` is the authentication (as `server/src/oauth-routes.ts`). Slack: `oauth.v2.access`. Linear: the token exchange with `actor=app`. GitHub: `installation_id`, and `code` for the user authorization.
- Uninstall events arrive on `POST /channels/:provider` (piece A); `parse` returns them as `Ignore` after the core removes the install (rule 7).

## Rules

### Installs

1. Slack bot scopes are v1's list (`ren-v1 slack/oauth.ts:10-30`) less `commands` and `assistant:write` until a piece needs them. Piece F confirms each scope against a call.
2. Linear: scopes `read`, `write`, `app:mentionable`, `app:assignable`, and `actor=app`. Without `write` Linear refuses every activity (v1 `73d68b833`).
3. GitHub: the App has "Request user authorization (OAuth) during installation" on, the account permission "Email addresses: read", and the repository permissions that pieces H and CH29 need.
4. An install for a workspace that another organization holds is refused with "installed for another organization" (CH22). A second install of the same provider in one organization is refused with the name of the existing install (CH30). A reinstall of the same workspace by the same organization replaces the secret and keeps the mappings (v1 `upsert`, `slack/CLAUDE.md`).
5. The install links the installer's provider account (CH24): Slack `authed_user.id` as `<team>:<user>`; GitHub from the user authorization. When `state` names a Slack user (Sign in with Slack) and `authed_user.id` differs, the install is refused (v1 `server/routes/slack.ts:136`).
6. The secret is an org credential sealed by `Envelope`. Linear's refresh runs in the credential refresh sweep (`core/src/credential-refresh.ts`). A Linear refresh that fails for good marks the install "Reconnect" in Settings.
7. Uninstall events remove the install, its credential and its mappings (CH25): Slack `app_uninstalled` and `tokens_revoked`; GitHub `installation` with action `deleted`; Linear's revoke event (piece G confirms its name). `channel_thread` rows stay, so a reinstall continues old threads.
8. `channel.install.remove` also asks the provider to revoke (Slack `auth.revoke`, GitHub `DELETE /app/installations/{id}`). A 404 counts as done. A failure is logged and the local removal still runs (github ledger row 38).

### After a Slack install (CH19)

9. A `DurableRunner` run `slack-onboard:<install id>` joins every public channel the bot is not in, page by page (`conversations.join`), and sends the installer one welcome DM. A failed join is logged and skipped. A reinstall joins again and sends no DM (slack ledger rows 85, 87).

### Mappings

10. The person who sets a mapping is a member of the target space. A mapping to an archived space is refused.
11. `channel.mapping.set` replaces the space, agent and fallback of the place. A removed mapping is not revived; a new `set` makes a fresh row (channels ledger row 19).
12. A new mapping, or a mapping that moves to another space, posts one notice in the place: "Ren answers here for <space>" (v1 `71ae13a8d`). A `set` that changes nothing posts nothing.
13. An archived space removes its mappings in the same transaction. Its places then go to the default space.
14. A mapping whose agent was removed or archived runs `ren`.
15. A mapping of a public GitHub repository starts with `fallback = false` (CH14). The repository's `private` flag is read at write time.

### GitHub tokens (CH29 to CH32)

16. Every workload of every space gets `GITHUB_TOKEN=ren:GITHUB`. No workload holds a GitHub token.
17. The egress resolves `GITHUB` for the hosts `api.github.com` and `github.com` (and `codeload.github.com`, `uploads.github.com`) by the lookup order of `core/src/credentials.ts:31`:
    1. The person credential `GITHUB`, where the workload serves that one person (`core/src/credentials.ts:231-254`).
    2. Otherwise the org's installation token, minted by Ren with the App JWT (RS256, issued 60 s in the past, 9 min lifetime) for every repository of the installation (CH31). Ren keeps a minted token until 5 minutes before its expiry and never stores it.
18. Git identity: the egress cannot set it, so the brain gets the four `GIT_*` values as plain env values with the placeholder (README §6.5). The person: name, and `<id>+<login>@users.noreply.github.com`. The bot: `<slug>[bot]`, and `<bot user id>+<slug>[bot]@users.noreply.github.com`. When the person credential applies, its values apply.
19. A mint that fails gives the egress a denial with a reason (`credential_missing`), never an empty token (v1 `manifest.ts:83-88`).
20. Sign in with GitHub, and "Connect GitHub" in Settings, store the person's token as the person credential `GITHUB`, sealed by `Envelope` (CH32). Better Auth's `account` row keeps no plain token: a database hook on `account` writes the credential and clears `access_token` and `refresh_token`. A GitHub user token that has a refresh token is refreshed by the sweep; a fatal refresh error (`bad_refresh_token`) deletes the credential (github ledger row 49).
21. An org with no GitHub installation and no person credential gets a denial for `GITHUB`. `git clone` of a public repository works without a token, because the egress injects only for a known label.

## Services and layers

| Service                        | Package | Does                                                                                                                                       | Layers       | Chosen by            |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------- |
| `ChannelInstalls.Service`      | `core`  | `start`, `complete` (the callback), `list`, `remove`, `removeByWorkspace` (uninstall events).                                              | one          | `server/src/main.ts` |
| `ChannelMappings.Service`      | `core`  | `places`, `set`, `remove`, and `placeOf(install, place)` for `ChannelRoute` step 1.                                                        | one          | `server/src/main.ts` |
| `ChannelProvider` (A)          | `core`  | Adds `install` (authorize URL, code exchange, workspace and installer read), `places(install)`, `revoke(install)`, `join(install, place)`. | per provider | —                    |
| `CredentialSource.layerMinted` | `core`  | Adds the GitHub installation mint for `GITHUB` (credentials README §5).                                                                    | one          | `server/src/main.ts` |

## Lifecycle states

| State                               | What happens                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Brain asleep, waking, restarting    | Nothing to renew: the workload holds `ren:GITHUB`. The egress injects at the next request.            |
| Mid-turn, token near expiry         | Ren mints again 5 minutes before expiry; the next request gets the new token. v1 INV-37 cannot occur. |
| Install removed mid-turn            | The next GitHub request is denied; the next channel event for the workspace is ignored.               |
| Linear token refresh fails for good | Replies to Linear fail with a typed error; Settings shows "Reconnect".                                |
| Space archived                      | Its mappings go; its places reach the default space.                                                  |

## Edge cases

| #   | Case                                                      | Rule                                                                                | Source                       |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| 1   | The app is removed on the provider's side.                | Uninstall event removes the install (rule 7).                                       | v1 had no handler            |
| 2   | A second organization installs the same workspace.        | Refused (rule 4).                                                                   | `server/routes/slack.ts:254` |
| 3   | A reinstall by the same organization.                     | New secret, same mappings.                                                          | `slack/CLAUDE.md` gotcha     |
| 4   | The Slack user who installs is not the one who signed in. | Refused (rule 5).                                                                   | `server/routes/slack.ts:136` |
| 5   | A GitHub token expired while the sandbox slept.           | The egress injects a fresh token.                                                   | INV-37, `73f92bce2`          |
| 6   | A failed installation mint.                               | A denial with a reason (rule 19).                                                   | `manifest.ts:83-88`          |
| 7   | A person token with no GitHub profile.                    | Sign-in reads `GET /user`; a failed read fails the sign-in.                         | github ledger row 48         |
| 8   | A repository renamed after it was mapped.                 | The mapping keys on the numeric repository id.                                      | github ledger row 15         |
| 9   | The default space is archived.                            | The oldest active space.                                                            | CH26                         |
| 10  | A Personal Space gains a second member.                   | DMs move to the default space; the person token stops there (`credentials.ts:231`). | CH27                         |
| 11  | Two `mapping.set` for one place at the same time.         | One row (unique index); both requests give that row.                                | channels ledger row 18       |

## Tests

Core tests with real Postgres and test provider items. Egress tests use the iron-proxy test harness of the credentials spec.

1. A second organization that installs the same workspace is refused.
2. A second Slack install in one organization is refused, with the existing install's name.
3. A reinstall by the same organization keeps the mappings and replaces the secret.
4. The Slack install links the installer as `<team>:<user>`; a different `authed_user.id` than the signed-in Slack user is refused.
5. Sign in with GitHub stores a sealed `GITHUB` credential; the `account` row has no token.
6. Slack `app_uninstalled` removes the install, its credential and its mappings; `channel_thread` rows stay.
7. The onboarding run joins public channels once and sends one welcome DM; a reinstall sends no DM.
8. A Slack DM goes to the sender's single-member space; with none, to the default space.
9. An unmapped place goes to `channels.defaultSpace`; when it is archived, to the oldest active space.
10. An archived space removes its mappings.
11. A mapping whose agent was removed runs `ren`.
12. A mapping of a public repository starts with the fallback off.
13. A new mapping posts one notice; the same `set` again posts nothing.
14. In a one-member space, a GitHub request gets the person token and the person's git identity; in a shared space, the installation token and the bot identity.
15. The installation token is minted again 5 minutes before expiry, and no request carries an expired token.
16. A failed mint gives `credential_missing`, not an empty token.
