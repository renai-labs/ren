# Credentials: app profiles

Status: spec written, not built. Linear: REN-1432 (Credentials), REN-1429 (Apps). Branch `app-profiles`, PR against `credential-connect` (#53), which builds on `apps` (#51). Neither #51 nor #53 is merged, and neither has production data.

This file is the core of the spec. Decisions are P1 to P47 (section 21). Section 17 lists the earlier decisions that this spec changes. The evidence is in [`references/profiles.md`](references/profiles.md). The skills work that follows this PR is in [`references/profiles-opencode.md`](references/profiles-opencode.md).

## 1. Goal

An app has one current definition. A **profile** is one set of accounts for one app: one credential per MCP and per env key of the app. A space runs an app when it reaches one of the app's profiles. Profiles replace installs (`space_app`), releases (`app_release`) and named connections.

Done when:

- An agency creates the shared profiles "Acme client" and "Globex client" of app `meta-ads`. Space `sales` reaches both. The brain has the servers `meta-ads__acme` and `meta-ads__globex`. The agent picks one by its display name.
- Ana creates a private profile of `google`. It runs in her Personal Space and in no space that has other members.
- An admin edits a registry app's MCP URL. Every brain that reaches a profile of the app gets the new definition at its next pull. The credentials of that MCP show Reconnect.
- Bob joins Ana's Personal Space. Ana's private accounts stop at once. The invite dialog warned about it first.
- Composio is a provider layer. Removing the layer leaves every app decodable, and its items show "unavailable". A Pipedream layer needs no change outside its own file and one registry entry.
- The composer pill shows the gaps of the profiles that the chat reaches.

Not in this spec:

- App skills in OpenCode. No app skill reaches OpenCode today; a later PR renders them ([`references/profiles-opencode.md`](references/profiles-opencode.md)).
- Settings in an MCP URL per profile, for example a Shopify store domain (P43).
- A notice to a holder when someone replaces their item (P27).
- The connect card in the chat (Ren MCP).

## 2. Words

| Word            | Meaning                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| App             | A unit of skills, MCP servers, env keys, packages and `dependsOn`. A registry app is public. A custom app belongs to one space (its owner space). |
| Definition      | The app's content: `mcps`, `skills`, `requiredCredentials`, `environment`, `dependsOn`. One per app. `app.revision` counts its edits.             |
| Profile         | One set of accounts for one app. It has a fixed slug (`acme`) and a display name ("Acme client").                                                 |
| Shared profile  | A profile that belongs to the org. Its access list says which spaces reach it.                                                                    |
| Private profile | A profile that belongs to one person.                                                                                                             |
| Access list     | The spaces that a shared profile names: `all_spaces`, or rows in `app_profile_space`.                                                             |
| Item            | One MCP whose auth is not `none`, or one env key of the app. An item has at most one credential per profile.                                      |
| Holder          | The person whose account a sign-in reached (`account_user_id`). A pasted key has no holder (P14).                                                 |
| Link            | A pointer from a profile to one profile of each app in its app's `dependsOn` (P8).                                                                |
| Reach           | The set of profiles that a space, and so each brain in it, may use (section 7).                                                                   |
| Gap             | An item without a credential, an item in status `reconnect`, a missing link, or a missing org OAuth app.                                          |
| Loose key       | A credential that belongs to no profile: owner `org`, `space`, `person` or `workload`.                                                            |
| Provider        | A managed MCP provider (Composio, later Pipedream). One layer of `McpProvider`.                                                                   |
| Binding fields  | The parts of an item's declaration that a token is bound to (P34).                                                                                |

## 3. What exists

| Part                                                                                      | State                                                                                                                                                                                                                                               | Evidence                                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Apps, releases, installs, pins, registry                                                  | Built in #51                                                                                                                                                                                                                                        | `core/src/app/*`, `core/src/space/app.ts`, `db/src/app.sql.ts`, `db/src/space-app.sql.ts`    |
| Catalog delivery by pull                                                                  | Built in #51. The cell stores the catalog and checks names                                                                                                                                                                                          | `core/src/brains.ts:454`, `cell/src/app-store.ts`, `cell/src/harness/opencode/plugin.ts`     |
| MCP servers in OpenCode                                                                   | Built in #51 (`def547bc4`, `335d06f17`) for MCPs that need no credential: remote servers in each chat, local servers on the session's environment, a wait until they connect before a turn. MCPs with auth `oauth`, `header` or `basic` are skipped | `cell/src/harness/opencode/mcp.ts` (`entries`, `servers`, `ready`)                           |
| OAuth sign-in, refresh, 401 and 403 reports, egress fork, client credentials, `OAuthApps` | Built in #53. This spec keeps them                                                                                                                                                                                                                  | `core/src/oauth.ts`, `core/src/credential-refresh.ts`, `repos/iron-proxy/internal/ren/*`     |
| App connect dialog, named connections, per-release requirements                           | Built in #53. This spec replaces them                                                                                                                                                                                                               | `core/src/credential-requirements.ts`, `app/src/features/credentials/connect-app-dialog.tsx` |
| Composio                                                                                  | Built in #53 as `McpProvider.layerComposio`. Its id and words reach six files outside the layer                                                                                                                                                     | [`references/profiles.md`](references/profiles.md) §2                                        |
| Personal Space                                                                            | Every member gets one when they join the org                                                                                                                                                                                                        | `core/src/space/provisioning.ts` (`createInitialMemberships`)                                |

## 4. Model

```
   author                         definition                              profiles (per org)

  ┌──────────────────────┐       ┌──────────────────────────────┐       ┌──────────────────────────────────────────┐
  │                      │       │                              │       │                                          │
  │   app.update         │ ────▶ │   app                        │ ────▶ │   app_profile  "Acme client" (acme)      │
  │   (owner space)      │       │     mcps, skills, env keys,  │  1:n  │     kind shared | private                │
  │                      │       │     environment, dependsOn   │       │     app_profile_space  (access list)     │
  │   registry publish   │       │     revision                 │       │     app_profile_link   (dependencies)    │
  │                      │       │                              │       │     credential × item  (owner profile)   │
  └──────────────────────┘       └──────────────────────────────┘       └─────────────────────┬────────────────────┘
                                                                                              │
                                                                                              ▼
                                                  ┌──────────────────────────────────────────────────────────────┐
                                                  │                                                              │
                                                  │   AppProfiles.reachable(scope)                               │
                                                  │     multi-member space: its list, all_spaces        (P45)    │
                                                  │     one-member space:   all the person can access   (P44)    │
                                                  │     + linked profiles                               (P8)     │
                                                  │     − archived apps                                 (P11)    │
                                                  │                                                              │
                                                  └───────┬───────────────────────┬───────────────────────┬──────┘
                                                          │                       │                       │
                                                          ▼                       ▼                       ▼
                                          ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
                                          │                       │ │                       │ │                       │
                                          │   AppResolve          │ │   Egress.resolve      │ │   composer pill       │
                                          │   .forScope           │ │   candidates          │ │   gaps                │
                                          │   catalog + finger-   │ │   = loose keys        │ │                       │
                                          │   print → pull        │ │   ∪ profile creds     │ │                       │
                                          │                       │ │                       │ │                       │
                                          └───────────────────────┘ └───────────────────────┘ └───────────────────────┘
```

## 5. Services and layers

| Service                                                | Change  | Does                                                                                                                                                                                           | Layers                                  |
| ------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `App` (`core/src/app.ts`)                              | changed | `update` takes the whole definition and `expectedRevision`. `create` also makes the owner-space profile (P13). `archive` is never refused for use (P11). `transferOwnership` loses `retainUse` | Postgres                                |
| `AppProfiles` (`core/src/app/profiles.ts`)             | new     | `list`, `get`, `create`, `rename`, `delete`, `access` (add, remove, `allSpaces`), `link`, `promote`, `reachable(scope)`                                                                        | Postgres                                |
| `AppResolve`                                           | changed | `forSpace` becomes `forScope(scope)`. `revision(scope)` reads ids and revisions only                                                                                                           | Postgres                                |
| `AppRegistry`                                          | changed | Publish writes the definition onto `app`. It finds apps by slug among registry apps only (P37)                                                                                                 | Postgres                                |
| `AppRelease`, `SpaceApp`                               | removed | —                                                                                                                                                                                              | —                                       |
| `Credentials`                                          | changed | Owner `profile`. `candidates(scope, profileIds)`, `environment(scope, profileIds)`, `removeForProfile`. Never imports `AppProfiles` (P41)                                                      | Postgres, `Envelope`                    |
| `CredentialRequirements`                               | changed | `forProfile(actor, profileId)`, `forScope(actor, scope)` (the pill)                                                                                                                            | —                                       |
| `OAuth`                                                | changed | `connect({ profileId, item, reconnect? })`. Provider flows move out                                                                                                                            | MCP SDK in Effect                       |
| `ProviderConnect` (`core/src/mcp-provider/connect.ts`) | new     | Start and finish a provider connect. The `route` refresher                                                                                                                                     | —                                       |
| `McpProvider.Registry`                                 | changed | `get(id)` → provider or `Unavailable`. Built from a list of provider layers                                                                                                                    | `layerComposio`; later `layerPipedream` |
| `profile-label` (`core/src/app/profile-label.ts`)      | new     | `labelOf(item, slug)`, `serverOf(mcp, slug)`                                                                                                                                                   | —                                       |
| `Egress`                                               | changed | Composes `scopeOf → AppProfiles.reachable → Credentials.candidates`                                                                                                                            | —                                       |

## 6. Contracts

### 6.1 Schema

| Item                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.Info`, `App.Declaration`                            | Gain the definition fields and `revision`. Lose `latestReleaseId`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `App.UpdateInput`                                        | The whole definition, plus `expectedRevision`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `AppRelease`, `SpaceApp`                                 | Removed. `AppRelease.Environment` and `AppRelease.Packages` move to `App`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AppProfile` (`@ren/schema/app-profile`), new            | `ID` (`apf`). `Slug` (a `Primitive.Slug` of at most 32 characters). `Info` = `{ id, appId, slug, name, kind, userId \| null, allSpaces, spaces: Space.Ref[] (those the caller may see), hiddenSpaces: number, links: { appId, profileId \| null }[], items: Item[], unused: { credentialId, label }[], createdBy, createdAt, updatedAt }`. `Item` = `{ item: { mcp } \| { env }, kind, label, name, status: ok \| missing \| reconnect \| unavailable, credentialId \| null, holder: { userId, name } \| null }` |
| `Credential.Owner`                                       | Gains `{ kind: "profile", profileId }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Credential.ConnectInput`                                | `{ profileId, item: { mcp: Slug }, reconnect? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Credential.CreateInput`                                 | A loose create (as today, with `label`), or a profile create `{ owner: profile, item: { mcp } \| { env }, value, hosts }` with no label                                                                                                                                                                                                                                                                                                                                                                          |
| `Credential.Label` in a loose create                     | Refuses a label that starts with `MCP_` (K45) or holds `__`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Credential.Info`                                        | Loses `app`, `mcp`, `connection`. Gains `profileId`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Credential.Connection`, `Credential.RequirementsInput`  | Removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Credential.Provider`, `Mcp.Transport.provider.provider` | A `Primitive.Slug`, not a list of literals (P38)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Mcp.Transport` provider                                 | `{ type: "provider", provider, integration }` (P40)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| App env keys                                             | At most 94 characters. No `__` (section 8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `AppCatalog.Catalog`                                     | `apps: { appId, appSlug, name, profiles: { slug, name, kind, env: Record<EnvName, EnvName> }[] }[]` (connected env items only); `mcps: McpEntry[]`; `skills: SkillEntry[]`; `unavailable: { appSlug, mcp, profile: string \| null, reason: "provider" \| "egress" }[]`; `environment`. `credentials` goes                                                                                                                                                                                                        |
| `AppCatalog.McpEntry`                                    | `{ appId, appSlug, slug, declaration, server, profile: { id, slug, name, kind } \| null, label: EnvName \| null, env?: Record<EnvName, string> }`. `profile` and `label` are null for an MCP with auth `none` (P22)                                                                                                                                                                                                                                                                                              |
| `AppCatalog.SkillEntry`                                  | `{ appId, appSlug, slug, declaration }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Infra.SpaceBindings.credentials`                        | Replaced by `profiles: Record<AppSlug, ProfileSlug[]>`: the shared profiles that list this space (P36)                                                                                                                                                                                                                                                                                                                                                                                                           |

Sealed values (core only):

```ts
// value of a credential with type "route": the provider's own state, opaque to core (P39)
{ type: "route", state: Json }
```

### 6.2 Database

| Table                                                | Change                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`                                                | Adds `required_credentials`, `environment`, `mcps`, `skills` (jsonb) and `revision` (integer, default 1). Drops `latest_release_id`                                                                                                                                                                                                                                                           |
| `app_dependency`, new                                | `app_id`, `dependency_app_id`. Primary key on both                                                                                                                                                                                                                                                                                                                                            |
| `app_profile`, new                                   | `id` (`apf_…`), `organization_id`, `app_id`, `slug`, `name`, `kind` (`shared` \| `private`), `user_id`, `all_spaces` (boolean, default false), `created_by_user_id` (set null), `created_at`, `updated_at`. Unique `(organization_id, app_id, slug)`. Check: `kind = 'private'` ⇔ `user_id` is set. Check: not (`kind = 'private'` and `all_spaces`). `organization_id` and `user_id` cascade |
| `app_profile_space`, new                             | `profile_id`, `space_id`. Primary key on both. Both cascade                                                                                                                                                                                                                                                                                                                                   |
| `app_profile_link`, new                              | `profile_id`, `dependency_app_id`, `dependency_profile_id`. Primary key `(profile_id, dependency_app_id)`. `profile_id` and `dependency_profile_id` cascade                                                                                                                                                                                                                                   |
| `credential`                                         | `owner` gains `profile`. Adds `profile_id` (cascade) and `made_for` (text). Drops `app_id`, `mcp`, `connection` and the index on `(app_id, mcp)`. The owner check gains: `owner = 'profile'` ⇔ `profile_id` is set and the other owner columns are null. Unique `(profile_id, label)` where `owner = 'profile'`                                                                               |
| `oauth_session`                                      | Drops `owner`, `user_id`, `space_id`, `app_id`, `release_id`, `mcp`, `connection`. Adds `profile_id` (set null, so a callback after a delete reads "This profile was deleted" and cleans up a provider account), `hosts` (text array) and `made_for` (text). Keeps `credential_id`, `label`, `name` and the sign-in columns                                                                                                                                                                    |
| `space_app`, `app_release`, `app_release_dependency` | Removed                                                                                                                                                                                                                                                                                                                                                                                       |

One migration replaces the five migrations of the stack: #51 `20261023201851_app-foundation`, `20261023204554_app-listing`; #53 `20261024173942_credential_connect`, `20261024173950_credential_reserved_mcp`, `20261024180759_oauth_session_same_account`. The three credential migrations of `main` stay. Drizzle `1.0.0-rc.5` picks migrations by name (`migrator.utils.js`, `getMigrationsToRun`), so the date order is not a problem.

### 6.3 Server and protocol

| Endpoint                       | Path                             | State                                                                                                               |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `app.update`                   | `PATCH /apps/:id`                | Changed: the definition and `expectedRevision`. A stale revision gives 409 "The app changed. Reload before saving." |
| `app-profile.list`             | `GET /app-profiles`              | New. `appId?`, `spaceId?`, page. Only profiles the caller may see                                                   |
| `app-profile.get`              | `GET /app-profiles/:id`          | New. → `AppProfile.Info`                                                                                            |
| `app-profile.create`           | `POST /app-profiles`             | New. `{ appId, name, slug, kind, allSpaces?, spaceIds?, links? }`                                                   |
| `app-profile.update`           | `PATCH /app-profiles/:id`        | New. `{ name? }`                                                                                                    |
| `app-profile.delete`           | `DELETE /app-profiles/:id`       | New. A custom endpoint, as `credential.delete`                                                                      |
| `app-profile.access`           | `POST /app-profiles/:id/access`  | New. `{ add?: Space.ID[], remove?: Space.ID[], allSpaces?: boolean }`                                               |
| `app-profile.link`             | `POST /app-profiles/:id/links`   | New. `{ appId, profileId \| null }`                                                                                 |
| `app-profile.promote`          | `POST /app-profiles/:id/promote` | New                                                                                                                 |
| `session.profiles`             | `GET /sessions/:id/profiles`     | New. The reachable profiles of the chat, with their gaps (P15)                                                      |
| `space.profiles`               | `GET /spaces/:id/profiles`       | New. The same for a new chat of the caller in that space                                                            |
| `credential.connect`           | `POST /credentials/connect`      | Changed input (6.1)                                                                                                 |
| `credential.create`            | `POST /credentials`              | Changed input (6.1)                                                                                                 |
| `credential.requirements`      | `GET /credential-requirements`   | Removed. `app-profile.get` and `session.profiles` replace it                                                        |
| `space-app.*`, `app-release.*` | —                                | Removed                                                                                                             |

Run `bun run generate` after the change.

### 6.4 Host API and cell

The pull contract (`PullRequest.apps`, `PullApps`) does not change. Its catalog has the shape of 6.1. The cell stores it and checks names with `McpEntry.server`. The cell never sees a provider, a profile rule or a label rule.

This PR renders profile servers in `cell/src/harness/opencode/mcp.ts`, and makes them work (P46, P47):

1. `entries` keeps every catalog entry. The filter on auth `none` goes. An unconnected item is not in the catalog (P23), so every entry has a credential.
2. The server name is `entry.server`, never `entry.slug`.
3. A remote entry with a `label` gets the header `Authorization: Bearer ren:<label>`. A header or basic MCP gets its field placeholders of `label` in its declared header.
4. A provider entry gets the provider host with the first path segment `ren:<label>` (K25). Core puts this address in `McpEntry.url`; the host is the credential's host.
5. A local entry gets `environment` = `transport.env` plus `entry.env`.
6. The description carries the profile name, never an account email (K39). OpenCode's server config has no description, so the `context` hook adds one line per profile server: "The MCP server gmail__acme is Gmail for the profile “Acme client”."
7. **Retry failed servers** (P47). When a turn starts, every Ren server in status `failed` or `needs_auth` is connected again. After a failure, Ren tries again 10 s, 1 min and 5 min later. Without this, a server whose connect got a 401 or a 403 `credential_reconnect` stays down after the person reconnects (`opencode/packages/core/src/mcp/index.ts:425-428,518-524`). The plugin API has `list`, `transform` and `reload`, and no per-server connect (`opencode/packages/plugin/src/promise/adapter.ts:444-448`). A `reload` alone does not connect a failed server again: OpenCode 2.0.27 skips each server whose config did not change. So a retry is two reloads: the first without the down servers, the second with them. Servers that work are not touched.
8. **The env note** (P26, P47). The `context` hook adds one system line per app with connected env items, from `apps[].profiles[].env`, in catalog order: "google profiles: Acme client → keys end in `__ACME` (`GOOGLE_PROJECT_ID__ACME`); Globex client → `__GLOBEX`". The `context` hook already adds the missing-environment line in `mcp.ts`. The text comes only from the catalog, so the same catalog gives the same bytes (INV-34).
9. **Unavailable servers** (P47). Core leaves out an entry whose provider has no layer, and every credential-backed entry on a brain without the egress (C53). It lists them in `catalog.unavailable`. The `context` hook adds one line each: "gmail (Acme client) is unavailable: the provider is not set up on this Ren", or "…: this chat cannot reach credentials".
10. **Duplicate tool ids.** Two Ren servers cannot give one OpenCode tool id (`<server>_<tool>`). A server name holds `_` only in `<mcp>__<slug>`, and `<mcp>` and `<mcp>__<slug>` never both exist, because one MCP has one auth type and its slug is unique in the org (P24). OpenCode keeps one tool per id before a plugin sees the list, so the cell could not detect a clash anyway.

## 7. Reach

```
   example: app google; profiles  "Acme client" (list: sales), "Globex client" (list: finance),
            "Org mail" (all_spaces), "Ana" (private), "Bob" (private)

  ┌─────────────────────────────┬───────────────┬──────────────────────────────────────┐
  │                             │               │                                      │
  │   space                     │   members     │   reaches                            │
  │                             │               │                                      │
  ├─────────────────────────────┼───────────────┼──────────────────────────────────────┤
  │   sales                     │   Ana, Bob    │   Acme, Org mail                     │
  │   finance                   │   Bob, Cy     │   Globex, Org mail                   │
  │   design                    │   Ana, Bob    │   Org mail                           │
  │   Ana's Personal Space      │   Ana         │   Ana, Acme, Org mail                │
  │   Bob's Personal Space      │   Bob         │   Bob, Acme, Globex, Org mail        │
  └─────────────────────────────┴───────────────┴──────────────────────────────────────┘
```

1. `AppProfiles.reachable(scope)` is the one function that decides reach. The catalog, the egress candidates and the pill all read it (P41).
2. A space with two or more active members reaches the shared profiles that list it, or that have `all_spaces` (P45).
3. A space with exactly one active member P reaches everything P can access: P's private profiles, plus every shared profile that lists any space P belongs to, or that has `all_spaces` (P44). This holds on every brain of the space (P31).
4. Both kinds of space also reach the profiles that their reached profiles link to, and so on down the chain (P8).
5. A profile of an archived app is not reached (P11). A dependency app with no items is reached wherever an app that depends on it is reached, with no profile (P33).
6. `scope` comes from `Credentials.scopeOf(workload)`. A session brain whose person left the space has no space, so it reaches nothing (A37).
7. Order: private profiles first, then shared, each sorted by app slug and then profile slug (INV-34).
8. App visibility (`AppQueries.isSpaceMember`, `queries.ts:107`) becomes: owner-space members, members of a space that reaches one of its profiles, admins, and everyone for a listed registry app. Creating a profile needs a visible app.

## 8. Names and labels

| Name      | Rule                                                                                    | Example                      |
| --------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| Server    | `<mcp>__<slug>`; `<mcp>` for an MCP with auth `none` (P22)                              | `gmail__acme`, `docs-search` |
| MCP label | `MCP_` + MCP slug in upper case with `-` as `_` + `__` + profile slug the same way (P7) | `MCP_GMAIL__ACME`            |
| Env label | key + `__` + profile slug (P7)                                                          | `SHOPIFY_TOKEN__ACME`        |

1. Core computes `server` and `label` in `profile-label.ts` (`serverOf(mcp, slug)`, `labelOf(item, slug)`) and puts them into the catalog. No other code builds a server name or a label.
2. Every reader of an MCP's name uses `McpEntry.server`, never `McpEntry.slug`:
   - `AppCatalog.nameConflicts` (`schema/src/app-catalog.ts:57-62`) groups MCPs by `server`. Today it groups by `slug`, so two profiles of one app (`gmail__acme`, `gmail__globex`) would count as a clash, and the cell would keep its old catalog (`plugin.ts`, `conflictsOf`).
   - `cell/src/harness/opencode/mcp.ts` names each OpenCode server `server` (§6.4 rule 2).
   - Skills keep `slug`: they load once per app.
3. Server names need no cleanup in OpenCode: a slug holds only `a-z`, `0-9` and single `-`, so `gmail__acme` stays `gmail__acme`, and its tools are `gmail__acme_<tool>`. A `__` never occurs in an MCP slug, so `<mcp>__<slug>` never equals another app's `<mcp>`.
4. A profile slug has at most 32 characters. `MCP_` + 64 + `__` + 32 = 102 ≤ 128 (`EnvName`). An app env key has at most 94 characters, and it holds no `__`. So every `__` in a profile label marks the slug, and one label never belongs to two items.
5. The slug never changes (A22). A rename changes `name` only. The server description carries the profile name, never an account email (K39).
6. MCP slugs, skill slugs and env key names are unique across all apps that have a profile in the org, or are reached as implied dependencies (P24, P35). The check runs when an app gets its first profile in the org, at a link, and at `app.update`. A key that two apps share goes into a shared dependency app.
7. A registry publish cannot be refused for one org. When it makes a clash or a package conflict in an org, `AppResolve` leaves out the colliding parts of the app whose first profile in the org is newer. It shows them on the Apps page: "gmail skipped: also in mail-kit" (P25).
8. Env keys exist only with the suffix (P26). The catalog's `apps[].profiles[].env` maps each key to its label. The render writes one note per app for the agent: "google profiles: Acme client → `__ACME`".
9. A local MCP that needs an env key runs once per profile. `McpEntry.env` maps the bare name to the profile's placeholder: `STRIPE_API_KEY=ren:STRIPE_API_KEY__ACME`.
10. A loose key never holds `__` in its label, so loose labels and profile labels never collide. Before this ships, the build lists the loose rows on `main` whose label holds `__`. Ask before that read.

## 9. Create a profile and connect items

```
   dialog                                       Ren core                                                      provider

  ┌────────────────────────────────┐  ①       ┌──────────────────────────────────────────────────────┐
  │                                │ ───────▶ │                                                      │
  │   Name   [Acme client]         │          │   AppProfiles.create → apf_1, live at once           │
  │   Slug   [acme]                │ ◀─────── │                                                      │
  │   ◉ Shared  ○ Private          │          └──────────────────────────────────────────────────────┘
  │   Spaces ☑ sales ☐ ops         │  ②  one click per item
  │          and 2 other spaces    │ ───────▶  credential.connect { profileId, item }
  │                                │             → session { credential_id, profile_id, label,
  │   gmail       [Connect]        │                         name, hosts, made_for } ──────────────────────▶  consent
  │   calendar    ● Ana            │ ◀───────  callback → credential { owner profile, apf_1, label,
  │   PROJECT_ID  [Paste]          │                         holder = initiator } ◀─────────────────────────  redirect
  │                                │
  │   depends on base              │  ③
  │   ◉ Use existing  ○ New        │ ───────▶  app-profile.link { appId: base, profileId }
  │                                │
  └────────────────────────────────┘
```

1. Entry points: the org's Apps page → an app → "New profile", or a space, with that space ticked (P12). From a space with other members, the dialog offers Shared only (P32).
2. Order: name and slug → shared or private → spaces (shared only) → items → dependency apps.
3. The profile exists from step ①. An app with no items is ready then ("Enable", P1). An abandoned dialog leaves an incomplete profile. It runs, and its gaps show (P9).
4. Items: one per MCP whose auth is not `none`, and one per env key from the app's own, each skill's and each local MCP's `requiredCredentials`, merged by name. An `optional` key is never a gap.
5. A sign-in uses `credential.connect`. A paste (fields, env key, client credentials) uses `credential.create` with owner `profile`. The server computes the label.
6. Before a sign-in into a shared profile, the dialog says who can use the account: "Everyone in sales and 2 other spaces, and in the personal spaces of their members", or "Everyone in the org" (A41, P21, P44).
7. The session records `credential_id`, `profile_id`, `label`, `name`, `hosts` and `made_for` at start (P18, P34). The callback reads only the session.
8. The callback fails the session, and cleans up a provider account, when: the profile is gone; the initiator can no longer see it; or the item is no longer in the app.
9. Two people connect one empty item at once: the first callback saves; the second fails with "Ana connected this first".
10. Dependencies: one section per `dependsOn` app that has items. "Use existing" lists the shared profiles the person can see, and for a private profile also the person's own private profiles. "New" creates a dependency profile with an empty list of its own. A missing link is a gap and does not block (P8).
11. A requirement of kind `oauth_app` is not an item. It is one gate per app, shown on every profile: "Set up the org OAuth app".
12. Same account (K41): after a callback, Ren compares the account hash with the same item in other profiles of the same app. It compares only shared profiles and the person's own private profiles.
13. Custom app create makes one shared profile that lists the owner space. Its name is the owner space's name, and its slug is that name as a slug, cut to 32 characters (P13).

## 10. Rights

| Action                             | Shared profile                                                                                                                   | Private profile                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Create                             | any member; the list holds only spaces they belong to, unless they are an admin (P5, P20)                                        | any member                                                       |
| See                                | admins; the creator; members of a listed space; everyone for `all_spaces`                                                        | the person; admins see metadata only (P5)                        |
| Connect, reconnect, delete an item | anyone who sees it; a reconnect makes them the holder (P27)                                                                      | the person                                                       |
| Rename, edit links                 | creator, admins                                                                                                                  | the person                                                       |
| Edit the list                      | creator and admins, each only for spaces they belong to; admins for all (P19). Writes are `add` and `remove`, never a whole list | —                                                                |
| Set `all_spaces`                   | admins (P20)                                                                                                                     | —                                                                |
| Delete                             | anyone who sees it (P28)                                                                                                         | the person, admins                                               |
| Promote                            | —                                                                                                                                | the person; the profile then lists the person's spaces (P6, P20) |
| Turn private                       | never (P29)                                                                                                                      | —                                                                |

A member sees the spaces of a list they belong to, and a count of the others (P21). `core/src/app/profile-policy.ts` states the table as `Policy.Document` statements with the relationships `profile.creator`, `profile.listedMember`, `profile.self`.

## 11. Lifecycle

| Event                                     | Result                                                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A holder leaves the org                   | Their sign-in credentials in every profile are deleted, and each provider account is cleaned up (K27). Their private profiles are deleted. Shared profiles they created stay (P10)                       |
| A member leaves a space                   | Nothing is deleted. Reach changes by section 7. Loose space keys follow owner-access §11                                                                                                                 |
| A member joins a one-member space         | The space becomes multi-member. The person's private profiles, and the profiles reached only through their other spaces, stop. The invite warns first when the space's chats used private profiles (P42) |
| A space is archived                       | Its `app_profile_space` rows go                                                                                                                                                                          |
| An app is archived                        | Its profiles stay and are not reached. The sweep keeps refreshing their tokens. Unarchive brings them back (P11)                                                                                         |
| A linked profile is deleted               | Its links go, and the linking profiles show "base not linked"                                                                                                                                            |
| An implied dependency gains items         | Every dependent profile shows "base not linked"                                                                                                                                                          |
| A registry app is withdrawn               | Existing profiles keep running. New profiles are refused                                                                                                                                                 |
| An org OAuth app is archived with `force` | Unchanged (owner-access §11)                                                                                                                                                                             |

Each mutation in this table and in section 7 clears the egress cache for the brains of the affected spaces, and changes the fingerprint where the catalog changes:

| Mutation                                       | Clears egress cache | Changes fingerprint |
| ---------------------------------------------- | ------------------- | ------------------- |
| profile create, delete, rename, promote        | yes                 | yes                 |
| access `add` / `remove`, `all_spaces`, link    | yes                 | yes                 |
| credential connect, delete (P23)               | yes                 | yes                 |
| app edit, archive, unarchive; registry publish | no                  | yes                 |
| a space member joins or leaves                 | yes                 | yes                 |
| space archive; a holder leaves the org         | yes                 | yes                 |

## 12. Edits and Reconnect

1. `app.update` replaces the definition, raises `app.revision` and sets `updated_at` (P2). There is no rollback; to undo, edit again.
2. Item status is per credential. It does not depend on the space.
3. At connect, Ren stores `made_for` = SHA-256 of the binding fields (P34):

   | Item kind           | Binding fields                                               |
   | ------------------- | ------------------------------------------------------------ |
   | OAuth MCP           | auth type, URL, borrowed client id, borrowed client resource |
   | Provider MCP        | auth type, provider, integration                             |
   | Header or basic MCP | auth type                                                    |
   | Env key             | none                                                         |

4. Status: `reconnect` when the hash differs from the current declaration's, or when the credential lacks a scope that the declaration asks for. A dropped scope changes nothing.
5. A new item is `missing`. A removed item's credential stays and is listed as unused. The egress does not accept its label (section 13).
6. A new field on a header or basic MCP makes the item `missing` until someone pastes it.
7. An item whose provider is not set up has status `unavailable` (P38).

## 13. Loose keys and the egress

1. `Egress.resolve`: `scopeOf(workload)` → `AppProfiles.reachable(scope)` → `Credentials.candidates(scope, profileIds)` → match → source → plan.
2. `candidates` returns the loose keys of the scope (as today) and the profile credentials of the given profiles whose label maps to a current item.
3. The owner lookup order applies to loose keys only. A profile label is unique among reachable credentials (section 8).
4. `Credentials.environment` gives `LABEL=ren:LABEL` for loose `key` rows (as today), and for each connected env item of the reached profiles.
5. A profile credential always uses the egress. `delivery: delivered` is for loose keys only.
6. Unchanged: the egress fork, `refreshable`, the 401 and 403 reports, `credential_reconnect`, `REN`, `MODELS`, workload credentials.

## 14. Providers

```
   core (knows no provider)                                       provider layers

  ┌──────────────────────────────────────┐                       ┌───────────────────────────────────┐
  │                                      │                       │                                   │
  │   McpProvider.Registry.get(id)       │ ────────────────────▶ │   layerComposio                   │
  │     unknown or not set up            │                       │     COMPOSIO_API_KEY              │
  │       → Unavailable                  │                       │                                   │
  │                                      │                       ├───────────────────────────────────┤
  │   ProviderConnect                    │                       │                                   │
  │     start, finish, route refresher   │                       │   layerPipedream (later)          │
  │                                      │                       │                                   │
  │   credential: provider (slug),       │                       └───────────────────────────────────┘
  │     provider_account_id (opaque),    │
  │     sealed { type: route, state }    │
  │                                      │
  └──────────────────────────────────────┘
```

Provider contract (Ren words only, P39):

| Method    | Input → output                                                            |
| --------- | ------------------------------------------------------------------------- |
| `connect` | `{ credentialId, integration, callbackUrl }` → `{ redirectUrl, account }` |
| `status`  | `account` → `active` \| `pending` \| `gone`                               |
| `open`    | `{ credentialId, integration, account }` → `state`                        |
| `route`   | `state` → `{ upstream, headers, expiresAt? }`                             |
| `renew`   | `state` → `state` (after a 401)                                           |
| `remove`  | `{ state?, account? }` → done. Idempotent: "already gone" counts as done  |

1. The provider id is a slug. Removing a layer leaves apps decodable. Their items show `unavailable`, and a connect fails with `McpProvider.Unavailable` (P38).
2. Core seals `state` and never reads it.
3. The egress keeps an allow reply no longer than `expiresAt` (C37).
4. Each provider pins one account per credential (Composio `connected_accounts`; Pipedream `x-pd-account-id`), so the provider never picks an account or returns connect links in tool answers (K24).
5. The callback route sends each session to `OAuth` or to `ProviderConnect` by its `kind`.
6. The cleanup run payload is `{ provider, account?, state? }`.
7. The `"composio"` literal leaves `oauth.ts`, `credential-source.ts`, `credential-requirements.ts` and `credential/offboarding.ts`. Each reads `credential.provider`.

| Provider  | `state`              | `route(state)`                                                                                                | `renew`                                                             |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Composio  | `{ sessionId, url }` | upstream = session URL; header `x-api-key`                                                                    | a new session for the same account; the old one is cleaned up (K29) |
| Pipedream | `{ app, accountId }` | upstream `remote.mcp.pipedream.net/v3`; headers `x-pd-*` and a Bearer token; `expiresAt` = the token's expiry | a new Bearer token                                                  |

## 15. Coupling rules

1. `Credentials` never imports `AppProfiles`. `Egress` composes them (P41).
2. `labelOf` and `serverOf` live in `profile-label.ts`. `OAuth`, `ProviderConnect`, `AppResolve` and `CredentialRequirements` import them from there.
3. `AppResolve` reads reach and which items have a credential. It never opens a value.
4. The cell sees only the catalog.
5. `core` imports no provider by name. `server/src/main.ts` builds the registry from the list of provider layers.

## 16. Lifecycle states

| State                                                                                            | What happens                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brain asleep                                                                                     | Nothing. On wake, the pull carries the current catalog                                                                                                               |
| Brain waking                                                                                     | The first pull compares fingerprints and gets the catalog of the current reach                                                                                       |
| Brain mid-turn, reach shrinks (access removed, member joins a one-member space, profile deleted) | The egress cache is cleared; the next request is denied. The servers leave at the turn end (the cell defers updates until idle)                                      |
| Brain mid-turn, reach grows or an item is connected                                              | The next request resolves. The new server appears at the next turn                                                                                                   |
| A server failed (401, 403, network) and the person reconnects                                    | At the next turn start the cell connects it again; between turns it retries after 10 s, 1 min, 5 min (§6.4 rule 7)                                                   |
| Brain mid-turn, app edit                                                                         | The catalog changes at the turn end. A credential whose binding fields changed shows Reconnect; until then, calls may fail upstream                                  |
| Ren down                                                                                         | Pulls fail; the brain keeps its catalog. The egress serves kept replies up to 15 minutes (C37). Reach changes made before the outage are already in the cache clears |
| Ren restarts during a sign-in                                                                    | `oauth_session` is in Postgres; a callback within 10 minutes completes, after the checks of section 9 rule 8                                                         |
| Provider down                                                                                    | Its MCP calls and connects fail. Cleanup runs retry for 24 hours (K27). Other credentials work                                                                       |
| Provider layer removed                                                                           | Items show `unavailable`. Existing rows stay; a later layer for the same id serves them again                                                                        |

## 17. Changes to earlier decisions

| Earlier                                                                            | Now                                                                                                    | Why                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| apps A2: releases, installs, pins                                                  | P1, P2                                                                                                 | One definition per app; profiles decide where it runs         |
| apps §6 rule 3, §7 3→4: the catalog per space                                      | Per scope (section 7)                                                                                  | Private profiles and one-member spaces                        |
| K33: items from the release a space uses                                           | Section 9 rule 4, from the current definition                                                          | P2                                                            |
| K34: `app_id`, `mcp`, `connection` on the credential                               | `profile_id`; the item from `(profile_id, label)` (P17)                                                | One profile per app gives the app                             |
| K35: dependency items in the dialog                                                | Links (P8)                                                                                             | A dependency has its own profile                              |
| K36: per-release, per-space reconnect check                                        | Section 12, per credential, binding hash (P34)                                                         | P2                                                            |
| K37–K40: named and default connections                                             | Profiles and their slugs (P7)                                                                          | One concept for "a second account"                            |
| K41: "same MCP and owner"                                                          | Section 9 rule 12                                                                                      | Owners go for app credentials                                 |
| K45: only connect makes `MCP_` labels                                              | Kept, and loose labels refuse `__` (section 8 rule 10)                                                 | `__` belongs to profiles                                      |
| connections §6.2 `oauth_session` columns                                           | 6.2 (P18)                                                                                              | —                                                             |
| connections §10, A36: provider shape                                               | Section 14 (P38–P40)                                                                                   | Pipedream, and removal                                        |
| owner-access A6: delete account credentials when the holder leaves a space         | Section 11                                                                                             | Profiles belong to the org                                    |
| owner-access §6 rule 3, A13: server name per connection                            | Section 8                                                                                              | —                                                             |
| connections §10b, §14 row "the MCP server name is `<mcp>` … `<mcp>__<connection>`" | Section 8: `<mcp>__<profile slug>`, `<mcp>` for auth `none`; the cell renders it in this PR (P46, P47) | Profiles replace connections; the OpenCode work is in this PR |
| owner-access §10, A28: requirements per session and per new chat                   | `session.profiles`, `space.profiles` (P15)                                                             | —                                                             |
| owner-access §12, A25: infra bindings alias labels                                 | P36                                                                                                    | Profiles replace label aliases                                |
| P3 (handoff): private profiles on session brains                                   | P44, P45, P31                                                                                          | Intersection of what members may use                          |
| P6 (handoff): promote to all spaces; turn private again                            | P20, P29                                                                                               | Members change only their own spaces                          |
| pr-51 gap 9: publish can write onto an org's app                                   | P37                                                                                                    | —                                                             |

## 18. Edge cases

| #   | Case                                                                       | Rule                                                                                                                                  | Decision          |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Two apps both have MCP `gmail` and a profile `acme` in one space           | Refused by the org-wide rule                                                                                                          | P24               |
| 2   | Two apps both declare `SHOPIFY_TOKEN`                                      | Refused; put the key in a shared dependency app                                                                                       | P35               |
| 3   | A registry publish adds MCP `gmail`, which an org's custom app already has | The newer app's `gmail` is left out in that org and shown                                                                             | P25               |
| 4   | Ana creates a private profile from `sales` (two members)                   | The dialog offers Shared only                                                                                                         | P32               |
| 5   | Bob joins Ana's Personal Space                                             | Private profiles stop; the invite warns                                                                                               | P42, P44          |
| 6   | Ana leaves `sales`                                                         | Her Personal Space loses the profiles it reached through `sales`                                                                      | P44               |
| 7   | Bob reconnects Ana's `gmail` in a shared profile                           | Allowed; Bob is the holder                                                                                                            | P27               |
| 8   | A member edits a list that also names spaces they are not in               | They see a count; their `add`/`remove` never touches the others                                                                       | P19, P21          |
| 9   | A shared profile tries to link Ana's private profile                       | Refused                                                                                                                               | Section 9 rule 10 |
| 10  | An app edit moves an MCP URL to a new path on the same host                | `reconnect` (the binding hash changes)                                                                                                | P34               |
| 11  | An app edit renames a header                                               | No reconnect                                                                                                                          | P34               |
| 12  | Composio's layer is removed                                                | Items `unavailable`; apps decode                                                                                                      | P38               |
| 13  | Two people connect one empty item at once                                  | The first saves; the second fails and is cleaned up                                                                                   | Section 9 rule 9  |
| 14  | The profile is deleted during a sign-in                                    | The callback fails with "This profile was deleted"                                                                                    | Section 9 rule 8  |
| 15  | A skill runs `gh` with `$GITHUB_TOKEN`                                     | Not set; the agent uses `GITHUB_TOKEN=$GITHUB_TOKEN__ACME` from the note                                                              | P26               |
| 16  | An MCP with auth `none` in an app with two profiles                        | One server, `<mcp>`                                                                                                                   | P22               |
| 17  | An item is not connected                                                   | Not in the catalog; the pill shows it                                                                                                 | P23               |
| 18  | A loose key with label `X__ACME`                                           | Refused                                                                                                                               | Section 8 rule 8  |
| 19  | A private profile and no one-member space                                  | Not possible today: every member has a Personal Space. If someone adds a member to it, the profile runs nowhere, and its view says so | Section 7         |
| 20  | A Pipedream Bearer token expires while the egress keeps an allow reply     | The reply lives no longer than `expiresAt`                                                                                            | Section 14 rule 3 |

## 19. Open

| Item                                                                                          | Needed by                           |
| --------------------------------------------------------------------------------------------- | ----------------------------------- |
| App skills in OpenCode ([`references/profiles-opencode.md`](references/profiles-opencode.md)) | The next PR                         |
| Settings in an MCP URL per profile (Shopify store)                                            | A later PR (P43)                    |
| A custom app whose owner space is archived: who edits it                                      | Not decided; admins can transfer it |
| The read-only check of loose labels with `__` on `main` (section 8 rule 10)                   | Before release; ask first           |

## 20. Tests

Write each test first. It must fail before its change. No mocks: real Postgres, real `Envelope.layerLocal`, the local OAuth server and the wire-level Composio server in `core/test/lib`.

| #   | Package and file                                         | Test                                                                                                                                                                                                                                         | Decisions             |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | `schema/test/app-profile.test.ts`                        | A slug of 33 characters fails. An app env key with `__` or over 94 characters fails. A loose label with `__` fails                                                                                                                           | P7, section 8         |
| 2   | `core/test/app-profiles.test.ts`                         | Create shared and private profiles. A second profile slug in one app and org fails. A custom app create makes the owner-space profile                                                                                                        | P5, P7, P13           |
| 3   | `core/test/app-profiles.test.ts`                         | Reach table of section 7, row by row, including links and an archived app                                                                                                                                                                    | P8, P11, P44, P45     |
| 4   | `core/test/app-profiles.test.ts`                         | Bob joins Ana's Personal Space: reach drops her private and inherited profiles, and the next `Egress.resolve` denies `MCP_GMAIL__ANA`                                                                                                        | P42, P44              |
| 5   | `core/test/app-profiles.test.ts`                         | A member's `access` add/remove touches only their spaces; `get` shows the hidden count; a member cannot set `all_spaces`                                                                                                                     | P19, P20, P21         |
| 6   | `core/test/app-profiles.test.ts`                         | Delete by a member who sees it; promote keeps credentials and labels and lists the person's spaces; turn-private does not exist                                                                                                              | P6, P28, P29          |
| 7   | `core/test/app-profiles.test.ts`                         | A shared profile cannot link a private profile. A zero-item dependency app is reached with no profile                                                                                                                                        | P8, P33               |
| 8   | `core/test/app-resolve.test.ts`                          | The catalog: `server`, `label`, private first; a no-auth MCP once as `<mcp>`; an unconnected item absent; the env note map                                                                                                                   | P22, P23, P26         |
| 9   | `core/test/app-resolve.test.ts`                          | Each mutation of section 11's table changes the fingerprint and clears the egress cache where marked                                                                                                                                         | Section 11            |
| 10  | `core/test/app-resolve.test.ts`                          | A registry publish that clashes leaves out the newer app's parts and reports them                                                                                                                                                            | P25                   |
| 11  | `core/test/app.test.ts`                                  | Two apps with MCP `gmail`, or env key `SHOPIFY_TOKEN`, cannot both get profiles. `app.update` with a stale revision gives 409                                                                                                                | P24, P35, section 12  |
| 12  | `core/test/oauth.test.ts`                                | Connect by `{ profileId, item }`: the session holds the five fields; the callback inserts owner `profile` with the holder; checks of section 9 rule 8; two concurrent first connects                                                         | P17, P18, P27         |
| 13  | `core/test/credential-requirements.test.ts`              | Binding hash: a URL path change gives `reconnect`; a header rename does not; a new scope does; a dropped scope does not                                                                                                                      | P34                   |
| 14  | `core/test/credential-requirements.test.ts`              | Items merge env keys of the app, its skills and local MCPs; an `oauth_app` requirement is one app gate                                                                                                                                       | Section 9 rules 4, 11 |
| 15  | `core/test/egress.test.ts`                               | Candidates hold loose keys and only reached profiles' current items; an unused credential is denied                                                                                                                                          | Section 13            |
| 16  | `core/test/credentials.test.ts`                          | A holder leaves the org: their sign-ins in every profile go, provider cleanup starts, private profiles go, a pasted key stays                                                                                                                | P10, P14              |
| 17  | `core/test/mcp-provider.test.ts`                         | A provider id with no layer gives `unavailable` and decodes. A second test provider layer works with no change outside its layer. Core never decodes `state`                                                                                 | P38, P39              |
| 18  | `core/test/egress.test.ts`                               | `route(state)` headers with `expiresAt` bound the egress reply's life                                                                                                                                                                        | Section 14 rule 3     |
| 19  | `server/test/app.test.ts`                                | Through HTTP: `space-app.*`, `app-release.*` and `credential.requirements` are gone; `session.profiles` lists gaps                                                                                                                           | P1, P2, P15           |
| 20  | `cell/test/mcp.test.ts`                                  | Two profiles of one app give `gmail__acme` and `gmail__globex`; each sends its own placeholder header, and the local MCP server gets each real token through the egress. A no-auth MCP is one server `<mcp>`. A local entry gets `entry.env` | Section 6.4, P22, P46 |
| 21  | `app` test of the profile dialog                         | From a two-member space, Private is not offered; the account notice names the spaces                                                                                                                                                         | P12, P32              |
| 22  | `app` test of the composer pill                          | Two gaps show "2 not connected"; a connect clears one                                                                                                                                                                                        | P15                   |
| 23  | `core/test/app-registry.test.ts`                         | Publish refuses a slug that a custom app holds                                                                                                                                                                                               | P37                   |
| 24  | `schema/test/infra.test.ts`                              | `SpaceBindings.profiles` decodes; `credentials` is gone                                                                                                                                                                                      | P36                   |
| 25  | `cell/test/mcp.test.ts`                                  | A server fails its connect with 403; the upstream then accepts; at the next turn start the server is `connected`, and a `connected` server was not restarted. Under `TestClock`, retries come at 10 s, 1 min, 5 min                          | P47 (§6.4 rule 7)     |
| 26  | `cell/test/mcp.test.ts`                                  | The env note: one line per app, in catalog order, byte-identical for the same catalog; no line for an app without connected env items                                                                                                        | P26, P47              |
| 27  | `core/test/app-resolve.test.ts`, `cell/test/mcp.test.ts` | A provider with no layer: the entry is left out and listed in `unavailable`; the chat gets the line                                                                                                                                          | P38, P47              |
| 29  | `schema/test/app-catalog.test.ts`                        | `nameConflicts` with two profiles of one app (`gmail__acme`, `gmail__globex`) finds no clash; `gmail__acme` twice finds one; a no-auth `docs-search` against OpenCode's reserved names still clashes                                         | Section 8 rule 2      |

## 21. Decisions

| ID  | Decision                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Installs go: `space_app`, `SpaceApp`, `space-app.*`. An app runs in a space when the space reaches one of its profiles. An app with no items runs through a profile with no items                                |
| P2  | Releases go: `app_release`, `app_release_dependency`, `app-release.*`, pins. One definition per app. An edit reaches every brain that reaches the app at its next pull                                           |
| P3  | Each reached profile gives its own servers `<mcp>__<slug>`; the agent picks by display name. Which profiles a space reaches: P44, P45                                                                            |
| P4  | App credentials belong to a profile (owner `profile`). Owners `org`, `space`, `person` and the lookup order stay for loose keys only                                                                             |
| P5  | Any member creates a shared profile. Admins see private profiles' metadata and may delete them, but never use, move or promote them                                                                              |
| P6  | Promote: the person only; same id, credentials and labels; kind becomes shared; it lists the person's spaces                                                                                                     |
| P7  | Labels `MCP_<MCP>__<SLUG>` and `<KEY>__<SLUG>`. A slug is unique per app in the org, across shared and private. Labels never change. Replaces named and default connections                                      |
| P8  | A profile links one profile of each `dependsOn` app. A linked profile runs wherever its linker runs; its own list can add more                                                                                   |
| P9  | An incomplete profile runs. Gaps show on the Apps page, the space tab and the pill                                                                                                                               |
| P10 | A holder leaves the org: their sign-ins in every profile are deleted and cleaned up at the provider; their private profiles are deleted                                                                          |
| P11 | An archived app's profiles stay, are not reached, and keep refreshing. Unarchive restores them. Archive is never refused for use                                                                                 |
| P12 | Entry points: the Apps page, or a space with that space ticked. Order: name → kind → spaces → items → dependencies                                                                                               |
| P13 | A custom app create makes a shared profile that lists only the owner space                                                                                                                                       |
| P14 | Only sign-ins have a holder. A pasted key stays when the person who pasted it leaves                                                                                                                             |
| P15 | The composer pill and `session.profiles` / `space.profiles` are in this PR                                                                                                                                       |
| P16 | A shared profile has `all_spaces`, or a list of spaces                                                                                                                                                           |
| P17 | `credential` drops `app_id`, `mcp`, `connection`. `(profile_id, label)` names an item                                                                                                                            |
| P18 | `oauth_session` carries `credential_id`, `profile_id`, `label`, `name`, `hosts` (and `made_for`, P34)                                                                                                            |
| P19 | A member sees and edits only the spaces of a list they belong to. Writes are `add` and `remove`                                                                                                                  |
| P20 | Only admins set `all_spaces`. A member's new or promoted profile lists the member's spaces                                                                                                                       |
| P21 | A member sees a count of the listed spaces they are not in                                                                                                                                                       |
| P22 | An MCP with auth `none` is one server per app, `<mcp>`                                                                                                                                                           |
| P23 | An item without a credential is not in the catalog                                                                                                                                                               |
| P24 | MCP and skill slugs are unique across the apps with profiles in an org                                                                                                                                           |
| P25 | A clash that an edit makes and Ren cannot refuse leaves out the newer app's parts, and the Apps page shows them                                                                                                  |
| P26 | Env keys exist only with the suffix. Ren tells the agent each profile's suffix by display name                                                                                                                   |
| P27 | Anyone who sees a shared profile may connect, reconnect and delete its items. A reconnect makes them the holder                                                                                                  |
| P28 | Anyone who sees a shared profile may delete it                                                                                                                                                                   |
| P29 | A shared profile never turns private                                                                                                                                                                             |
| P30 | Principle: a space reaches only what all its members may use. P44 and P45 apply it                                                                                                                               |
| P31 | In a one-member space, reach is the same on every brain                                                                                                                                                          |
| P32 | From a space with other members, the dialog offers Shared only                                                                                                                                                   |
| P33 | A dependency app with no items is reached wherever its dependent is, with no profile                                                                                                                             |
| P34 | `made_for` = hash of the binding fields. A different hash, or a missing declared scope, gives `reconnect`                                                                                                        |
| P35 | Env key names join the org-wide rule of P24                                                                                                                                                                      |
| P36 | `Infra.SpaceBindings.credentials` becomes `profiles: Record<AppSlug, ProfileSlug[]>`                                                                                                                             |
| P37 | Registry publish matches registry apps only, and refuses a slug that a custom app holds                                                                                                                          |
| P38 | A provider id is a slug checked at run time. A missing provider gives `unavailable`                                                                                                                              |
| P39 | Provider contract of section 14: opaque `state`, Ren statuses, headers per credential with an expiry, `ProviderConnect` outside `oauth.ts`                                                                       |
| P40 | `toolkit` becomes `integration`                                                                                                                                                                                  |
| P41 | Coupling rules of section 15                                                                                                                                                                                     |
| P42 | A one-member space whose chats used private profiles warns before it gains a member                                                                                                                              |
| P43 | Settings in MCP URLs per profile come later                                                                                                                                                                      |
| P44 | A one-member space reaches its person's private profiles and every shared profile that lists any space of that person, or has `all_spaces` (ren-v1 `vault/resolution.ts`)                                        |
| P45 | A multi-member space reaches the shared profiles that list it, or have `all_spaces`                                                                                                                              |
| P46 | This PR renders credential-backed profile servers in `cell/src/harness/opencode/mcp.ts`: name `server`, placeholder header from `label`, `env` for local servers                                                 |
| P47 | This PR also builds the OpenCode parts that MCPs need to work: retries of failed servers, the env note and `unavailable` reasons (§6.4 rules 7–9). App skills come in the next PR |
