# Credentials: sign-in, refresh, Composio and upstream 401

Status: spec written, not built. Linear: REN-1432 (Credentials), REN-1439 (Credential proxy). It builds on [`README.md`](README.md), [`owner-access.md`](owner-access.md) and the apps of PR #51 (branch `apps`). PR #50 built the egress, pasted keys and the refresh sweep frame. PR #50 lists the parts of this spec as "Not in this PR".

> Superseded in part by [`profiles.md`](profiles.md) (§17 there): §10a, §10b, K33–K41, the `oauth_session` columns of §6.2, the Composio shape of §10 (now §14 of profiles.md), and the §14 rows about server names and the OpenCode work.

This file is the core of the spec. The evidence is in [`references/connections.md`](references/connections.md) (rows S, U, P, C, R, I) and [`references/ren-v1.md`](references/ren-v1.md). Decisions in this file are K1 to K48. Section 13 lists the earlier decisions that this spec changes.

## 1. Goal

A person signs in to an OAuth MCP server or connects a Composio app. Ren keeps the token valid without a person and without the workload. When an upstream refuses a token, Ren renews it once and the next request works.

Done when:

- A person connects Linear's MCP server with OAuth. Ren finds the server's endpoints live and registers a client. The workload gets `ren:MCP_LINEAR`. The egress injects the token.
- The Linear token expires after 1 hour. The sweep renews it 20 minutes before expiry. No request fails.
- A token with no expiry stops working. The next request gets 401. The egress reports it. Ren refreshes once. The request after it works.
- A person connects Gmail through Composio. The agent calls the Gmail MCP tools. The sandbox holds no Composio key and no session URL. The agent cannot create or remove Composio connections.
- The person deletes the Gmail credential. Ren deletes the Composio session and the connected account, and asks Google to revoke the grant.
- A person clicks Connect on an app with three MCP servers. The dialog shows one item per MCP. Each click runs one sign-in. The app's dependencies show below it.
- A space connects Meta Ads for two clients. Each client is one named connection with its own sign-in.

Not in this spec:

- How the brain writes MCP servers into OpenCode, and the pull contract for them. Another person owns this work (section 14).
- The connect card in the chat. It moved to Ren MCP.

## 2. Words

| Word               | Meaning                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Revision           | A number on each credential. It goes up by 1 each time the value changes: sign-in, reconnect, refresh, rotate, new Composio session.     |
| Refresher          | The code that gets a new value for one credential type. It reads and returns. It does not write.                                         |
| Sweep              | The `DurableRunner` run `credential-refresh`: every 5 minutes, one run for all Ren copies (C51).                                         |
| 401 report         | The message that the egress sends to Ren when an upstream answers 401 to a request with a refreshable credential.                        |
| Issuer             | The identity URL of an OAuth authorization server (`issuer` in its metadata).                                                            |
| Discovery          | Finding the authorization server of an MCP server from its metadata documents (RFC 9728, then RFC 8414 or OpenID Connect Discovery).     |
| Connected account  | A Composio record of one grant to one app account, for example one Gmail mailbox. Composio refreshes its tokens.                         |
| Composio session   | A Composio configuration for one user: apps, auth config, pinned accounts, tools. Its `mcp.url` is the MCP endpoint. It does not expire. |
| Auth config        | A Composio record per project and app that says which OAuth app Composio uses. "Composio managed" means Composio's own OAuth app.        |
| Item               | One line in an app's connect dialog: one MCP server, or one env key of the app.                                                          |
| Named connection   | A second or later credential for one MCP, with its own connection slug, for example `MCP_META_ADS__ACME`.                                |
| Default connection | The first credential of an MCP, `MCP_<MCP>`, with no connection slug.                                                                    |

## 3. What exists

| Part                                | State                                                                                                                         | Evidence                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Refresh sweep frame                 | Built. Every 5 min, rows that expire within 10 min, 2-min lease, fatal deletes the row, transient counts `refresh_failures`.  | `core/src/credential-refresh.ts:33-37,55-118`                      |
| Refreshers                          | None. The server starts the sweep with `layerNoRefreshers`, so it renews nothing.                                             | `server/src/main.ts:75`                                            |
| OAuth and route values              | `Credential.Type` names them. `Credential.Value` cannot hold them.                                                            | `schema/src/credential.ts:226,288-298`                             |
| Value sources                       | `Static` (pasted values) and `Minted` (`REN`, `MODELS`) only.                                                                 | `core/src/credential-source.ts:216-227`                            |
| `route` op                          | Built in the egress. It appends the request path to the upstream. A placeholder left in the request makes the egress deny it. | `repos/iron-proxy/internal/ren/scan.go:183-193`, `handle.go:85-93` |
| Response handling in the egress     | It masks injected values. It reports nothing to Ren.                                                                          | `repos/iron-proxy/internal/proxy/proxy.go:689-690`                 |
| Tables `oauth_session`, `oauth_app` | Not built.                                                                                                                    | `db/src/credential.sql.ts`                                         |

## 4. Model

```
 person (app)            Ren core                                                     provider
┌─────────────────┐     ┌───────────────────────────────────────────────────────┐    ┌─────────────────────────┐
│ connect          │ ──▶ │ OAuth.connect: owner rules → discovery → client →      │ ─▶ │ consent (OAuth server   │
│ (MCP or Composio)│     │   oauth_session { state, PKCE, issuer, credential_id } │    │ or Composio)            │
│                  │ ◀── │ GET /oauth/callback: consume state → exchange or       │ ◀─ │                         │
└─────────────────┘     │   McpProvider.complete → credential row (revision 1)   │    └─────────────────────────┘
                        └──────────────┬────────────────────────────────────────┘
                                       │ sweep every 5 min: expires_at < now + 20 min
                                       ▼
                        ┌───────────────────────────────────────────────────────┐   invalidate  ┌────────────┐
                        │ CredentialRefresh: lease → refresher(current)          │ ────────────▶ │ egress     │
                        │   → UPDATE … WHERE revision = read → revision + 1      │               │ copies     │
                        │ afterUnauthorized(report): same refresher, same write  │ ◀──────────── │ 401 report │
                        └───────────────────────────────────────────────────────┘               └─────┬──────┘
                                                                                                      │ inject
 workload ── Bearer ren:MCP_LINEAR ──▶ egress ── token (revision 4) ──▶ mcp.linear.app ◀─────────────┘
 workload ── backend.composio.dev/ren:MCP_GMAIL/… ──▶ egress ── route + x-api-key ──▶ Composio session URL
```

## 5. Services and layers

| Service                                      | Does                                                                                                                                                                                                                                                                                                                                               | Layers                                                                           | Chosen by            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------- |
| `OAuth` (`@ren/core/OAuth`), new             | `connect`, `callback`, `session`, `complete` (not built). Discovery (section 7), client choice, PKCE, `state`, `iss`, token answer rules. The `oauth` refresher.                                                                                                                                                                                   | One: the MCP SDK inside Effect, as OpenCode does (A17)                           | `server/src/main.ts` |
| `OAuthApps` (`@ren/core/OAuthApps`), new     | As owner-access §7.                                                                                                                                                                                                                                                                                                                                | One: Postgres and `Envelope`                                                     | `server/src/main.ts` |
| `McpProvider` (`@ren/core/McpProvider`), new | Per provider: `connect(credentialId, toolkit)` → redirect; `complete(credentialId, toolkit)` → `{ upstream, sessionId, accountId, hosts }`; `renew(credentialId, toolkit, accountId)` → a new session; `remove(sessionId, accountId)`; `status(accountId)`; `headers()`. A `Registry` picks a provider by id, like `EnvironmentProvider.Registry`. | `layerComposio` (`COMPOSIO_API_KEY`)                                             | `server/src/main.ts` |
| `CredentialRefresh`, changed                 | The sweep and `afterUnauthorized(report)`. One lease, one write with the revision check, one cache clear (section 8).                                                                                                                                                                                                                              | Refreshers: `oauth` and `client_credentials` (sweep and 401), `route` (401 only) | `server/src/main.ts` |
| `CredentialSource`, changed                  | `layerStatic` also opens `oauth` and `client_credentials` values and gives the access token as a key. `layerProvider` (new) opens `route` values and adds `McpProvider.headers()`.                                                                                                                                                                 | `layerStatic`, `layerProvider`, `layerMinted`                                    | `server/src/main.ts` |
| `Egress`, changed                            | The allow reply carries `refreshable`. New `unauthorized(principal, report)`. A credential with status `reconnect` gets the denial `credential_reconnect`.                                                                                                                                                                                         | —                                                                                | —                    |
| `Credentials`, changed                       | Raises `revision` on each value change. The requirement check reads `McpProvider.status` for `route` credentials, cached for 5 min.                                                                                                                                                                                                                | —                                                                                | —                    |

## 6. Contracts

### 6.1 Schema

| Item                                | Change                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Injection.Reply` (allow)           | Adds `refreshable: Array<{ label, revision }>`: the labels in this reply that Ren can renew after a 401, with the revision it injected.                                                                                                                                                                                 |
| `Injection.Op` `route`              | Adds `placeholder`: the first path segment that the egress removes before it forwards.                                                                                                                                                                                                                                  |
| `Injection.DenyReason`              | Adds `credential_reconnect`.                                                                                                                                                                                                                                                                                            |
| `Mcp.Auth.oauth`                    | `authorizationEndpoint` and `tokenEndpoint` become optional. They are a fallback for discovery (K9).                                                                                                                                                                                                                    |
| `OAuth.NoRefreshToken`              | Removed (K6).                                                                                                                                                                                                                                                                                                           |
| `Credential.ConnectInput`           | As owner-access §8, with the target `{ kind: "mcp", app: App.ID, mcp: Slug, connection?: Slug, connectionName?: string }`. It serves OAuth and provider MCPs (section 10a).                                                                                                                                             |
| Connection slug                     | `Primitive.Slug` with at most 58 characters, so `MCP_<MCP>__<CONNECTION>` stays within the 128 characters of `EnvName` (K40).                                                                                                                                                                                           |
| `Credential.Requirement.Item`       | As owner-access §8, plus `app: App.ID`, `mcp: Slug \| null` and `group: App.ID` (the app that the dialog shows it under).                                                                                                                                                                                               |
| `@ren/schema/oauth-app`             | As owner-access §8.                                                                                                                                                                                                                                                                                                     |
| `Credential.CreateInput`            | Adds the value `{ type: "client_credentials", clientId, clientSecret: Redacted, tokenEndpoint: HttpsUrl, tokenEndpointAuth?, scopes? }` (owner-access §8).                                                                                                                                                              |
| `Credential.Label` in `CreateInput` | Refuses a label that starts with `MCP_`. Only `credential.connect` makes `MCP_` labels (K45).                                                                                                                                                                                                                           |
| `Credential.Info`                   | Adds `app`, `mcp`, `connection`, `provider` and keeps `status`. `revision`, `provider_account_id`, `account_subject_hash`, `unauthorized_refresh_at` and `wanted_scopes` stay internal. `credential.list` and `credential.get` are Ren MCP tools (PR #52, `Mcp.Tool`), so every `Info` field reaches MCP clients. (K48) |
| `OAuthSession.CompleteInput`        | `{ callbackUrl: string }`, at most 4096 characters. Not built.                                                                                                                                                                                                                                                          |

Sealed values (core only, never in the API):

```ts
// value of a credential with type "oauth"
{ type: "oauth", accessToken, issuer?: string,
  refresh?: { refreshToken, clientId, clientSecret?, tokenEndpoint,
              tokenEndpointAuth: "none" | "client_secret_basic" | "client_secret_post",
              resource?: string, scope?: string } }
// value of a credential with type "client_credentials"
{ type: "client_credentials", clientId, clientSecret, tokenEndpoint,
  tokenEndpointAuth: "client_secret_post" | "client_secret_basic", scope?: string, accessToken?: string }
// value of a credential with type "route"
{ type: "route", upstream: string /* Composio session.mcp.url */, sessionId: string }
// value of a credential with status "reconnect" after a fatal refresh
{ type: "cleared" }
```

### 6.2 Database

| Table           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credential`    | Adds `revision` (integer, not null, default 1), `provider` (text: `composio`), `provider_account_id` (text, a Composio connected account id), `oauth_app_id` (references `oauth_app`), `unauthorized_refresh_at` (timestamp of the last 401 refresh), `wanted_scopes` (text array, scopes from 403 challenges), and for MCP credentials `app_id` (references `app`), `mcp` (text, the MCP slug) and `connection` (text, null for the default connection), and `account_subject_hash` (text, SHA-256 of the provider's account id, null when the provider gives none). Index on `(app_id, mcp)`. |
| `oauth_session` | As owner-access §5, plus `issuer` (text), `credential_id` (text), `app_id`, `release_id`, `mcp` and `connection`. `credential_id` is chosen when the sign-in starts: a new id, or the id of the credential that a reconnect replaces. `release_id` is the release that the space uses when the sign-in starts.                                                                                                                                                                                                                                                                                  |
| `oauth_app`     | As owner-access §5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 6.3 Server and protocol

| Endpoint                                  | Path                                | State                                                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credential.connect`                      | `POST /credentials/connect`         | As owner-access §8                                                                                                                                                                                                                              |
| `oauth-session.get`                       | `GET /oauth-sessions/:id`           | As owner-access §8                                                                                                                                                                                                                              |
| `oauth-session.complete`                  | `POST /oauth-sessions/:id/complete` | Not built. Input: the address that the person landed on. Checks `state` and a provider `error`.                                                                                                                                                 |
| `oauth-app.*`                             | `/oauth-apps`                       | As owner-access §8                                                                                                                                                                                                                              |
| OAuth callback (server route, not in SDK) | `GET /oauth/callback`               | As owner-access §8. Serves OAuth and Composio.                                                                                                                                                                                                  |
| Client metadata document                  | `GET /oauth/client.json`            | As owner-access §8 (A33)                                                                                                                                                                                                                        |
| `egress.unauthorized` (`@ren/egress-api`) | `POST /egress/v1/unauthorized`      | New, beside `egress.resolve` in the same contract. The caller check is the same as for `resolve`: Ren's egress over mTLS now; a customer proxy, limited to its org, once registered keys exist (README §6.6). Body: `{ login, host, status: 401 | 403, scope?, labels: [{ label, revision }] }`. `scope`is the`scope`of a 403`insufficient_scope` challenge. Answers 204 at once; the work runs in the background. (K44) |

### 6.4 Egress fork

| Change                                                                                                                                                                                                                                                         | Where                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Read `refreshable` from the reply. Keep it in `Applied`.                                                                                                                                                                                                       | `internal/ren/client.go`, `handle.go`             |
| After the upstream answers 401: drop this copy's kept replies for the labels in `refreshable`, return the 401 to the workload unchanged, and send the 401 report in the background. Send at most one report per label and revision every 60 s per egress copy. | `internal/proxy/proxy.go:689-690`, next to `Mask` |
| `route` with `placeholder`: remove the first path segment when it equals the placeholder, raw or with `:` encoded as `%3A`. Then append the rest of the path to the upstream.                                                                                  | `internal/ren/scan.go:183-193`                    |
| `credential_reconnect` uses the denial shape of C42.                                                                                                                                                                                                           | `internal/ren/handle.go:24-40` (no change)        |

## 7. Sign-in

```
 app                              Ren                                                              OAuth server
 POST /credentials/connect ──▶ ① owner rules, before consent (README §6.4 rule 3)
                               ② discovery: POST initialize without a token → 401 WWW-Authenticate
                                  → resource metadata → issuer → server metadata                   ◀──▶ metadata
                               ③ client: org app → borrowed client → metadata document → registration ◀──▶ register
                               ④ oauth_session { state, PKCE S256, scope, resource, issuer, client, credential_id }
 ◀── Redirect
 new tab ───────────────────────────────────────────────────────────────────────────────────────▶ consent
 GET /oauth/callback?state&code&iss ◀──────────────────────────────────────────────────────────── redirect
                               ⑤ consume state once; check iss; exchange (code_verifier, resource)  ◀──▶ token
                               ⑥ token answer rules → seal → save (revision + 1 on a reconnect) → clear caches
```

Rules:

1. Ren checks the owner rules when the connect starts, before the consent screen (README §6.4 rule 3).
2. Discovery follows the MCP authorization spec (2026-07-28):
   - First, protected-resource metadata: the `resource_metadata` value from the `WWW-Authenticate` header of an `initialize` request sent without a token; else `/.well-known/oauth-protected-resource<path>`; else `/.well-known/oauth-protected-resource`.
   - Then the authorization server's metadata from its `authorization_servers[0]`. For an issuer with a path, try `/.well-known/oauth-authorization-server<path>`, then `/.well-known/openid-configuration<path>`, then `<path>/.well-known/openid-configuration`. For an issuer with no path, try `/.well-known/oauth-authorization-server`, then `/.well-known/openid-configuration`.
   - With no protected-resource metadata, Ren uses the MCP server's origin as the authorization server (MCP SDK behaviour, `client/auth.js:662-688`). (S1, S2, S3, K9)
3. When discovery finds no authorization server metadata, Ren uses the declared `authorizationEndpoint` and `tokenEndpoint`. When both exist and differ, live discovery wins and Ren logs the difference. Two cases use their own endpoints and skip discovery:
   - An org app with `discovery: static` (S8).
   - A borrowed client (`Mcp.Auth.oauth.client`). (K9)
4. Client order:
   1. An org app, when the MCP requires one (a `Credential.OAuthApp` requirement). A missing app gives `OAuth.AppNotConfigured`.
   2. A borrowed client.
   3. Ren's client metadata document, when the server metadata has `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`.
   4. Dynamic registration, when the server metadata has `registration_endpoint`. MCP 2026-07-28 deprecates it and keeps it only for servers without client metadata documents, so it is the last choice. (I11)
   5. Else `OAuth.AppNotConfigured`. (A17, A33)
5. Scope order: the `scope` in the `WWW-Authenticate` header, then `scopes_supported` from the protected-resource metadata, then the declared `Mcp.Auth.oauth.scopes`. Ren adds `offline_access` when the server's `scopes_supported` lists it, so the server is more likely to give a refresh token (MCP 2026-07-28, "Refresh Tokens"). A reconnect adds the scopes in `wanted_scopes` (section 9 rule 7). (S5, K46)
6. `resource` is the `resource` of the protected-resource metadata. It must match the MCP URL or its origin. Without metadata, `resource` is the MCP URL without a trailing slash. Ren sends it in the authorize request and in the token request. Each refresh sends exactly what the sign-in sent (INV-87). (K10)
7. PKCE: Ren always sends S256. Ren refuses the server when its metadata lists `code_challenge_methods_supported` without `S256`. A missing list is accepted. (K8)
8. The session records the client, the endpoints, the issuer, the scope and the resource that start chose. The callback uses these values. It never looks them up again. (S7)
9. The callback:
   - It consumes `state` atomically (ren-v1 bug 13).
   - Ren checks `iss` before it reads anything else of the answer, error answers included (MCP 2026-07-28, RFC 9207 §2.4). The comparison is plain string equality, with no case folding, port, slash or percent-encoding normalization:

     | Server metadata `authorization_response_iss_parameter_supported` | `iss` in the answer | Ren                              |
     | ---------------------------------------------------------------- | ------------------- | -------------------------------- |
     | `true`                                                           | present             | Compare with the recorded issuer |
     | `true`                                                           | absent              | Reject                           |
     | `false` or absent                                                | present             | Compare with the recorded issuer |
     | `false` or absent                                                | absent              | Go on                            |

     On a mismatch the session fails, and Ren does not use or show the answer's `error`, `error_description` or `error_uri`. (K7)

   - After the `iss` check, a provider `error` fails the session with its `error_description`.
10. Token answer rules:
    1. A refresh token is optional.
    2. No `expires_in` means no expiry: `expires_at` stays empty.
    3. `expires_in` is a number or a numeric string. Zero, a negative value or anything invalid counts as missing.
    4. A 2xx answer with `error` and no `access_token` is an error.
    5. `token_type` must be `Bearer` in any case, or missing.
    6. Ren records the issuer in the sealed value. (K5, K6, K7)
11. Google gets `access_type=offline` and `prompt=consent` as authorize parameters of its app or its declaration. They are not a rule for other providers. (K6)
12. When the server answers that it needs no sign-in (the SDK returns `AUTHORIZED` at start), the connect fails with "This server does not ask for sign-in". (S6)
13. A reconnect signs in again for the same `credential_id`. The old value works until the callback saves the new one. The save raises `revision` and clears the egress caches. (S18, README §6.9 rule 5)
14. The return address is Ren's config, never the caller's (README §6.9 rule 3). Dynamic registration runs again on each connect. An org app's provider console must list Ren's callback address; a change of Ren's domain needs a change there. (S4)
15. Ren makes every request of a sign-in and of a refresh to a public HTTPS address only. It follows no redirect, stops after 10 s, and reads at most 1 MiB of the answer. (S16)
16. Ren sends an org app's client secret only to that app's token endpoint (ren-v1 bug 9).
17. A session expires after 10 minutes. The sweep deletes sessions older than 1 day (owner-access §9 rule 4).

## 8. Refresh

1. The sweep selects credentials with status `ok`, a refresher for their type, and `expires_at` earlier than now + 20 minutes. (K12)
2. The sweep takes the 2-minute lease that exists today (`credential-refresh.ts:61-76`). The refresher gets the current value and revision. It returns `{ value, expiresAt?, scopes? }`. (K11)
3. The sweep saves the result with `UPDATE credential SET value, expires_at, scopes, revision = revision + 1, refresh_failures = 0, refresh_lease_at = null WHERE id = ? AND revision = <the revision read>`. When no row matches, a reconnect won; Ren drops the result. Then Ren tells every egress copy to drop its kept replies for the label (C40). (U3, K11)
4. A refresh answer without `refresh_token` keeps the old one. Without `scope` it keeps the old scopes. A new refresh token is saved before any other check, for example an ID-token check. (S13, ren-v1 bug 6)
5. A token with an expiry and no refresh token gets status `reconnect` when it expires. A token with no expiry is never swept; only the 401 path renews it. (K6, U6)
6. Ren reads the error code from the raw answer, as a string or as `{ error: { … } }`. Only an answer with HTTP 400 or 401 and `invalid_grant`, `invalid_client` or GitHub's `bad_refresh_token` is fatal. A 5xx, a 429, a network error, a timeout and an unknown code are temporary. (S14, S15, ren-v1 bugs 4 and 5)
7. Fatal: Ren sets status `reconnect`, replaces the value with `{ type: "cleared" }`, raises `revision` and clears the caches. The egress then denies the label with `credential_reconnect`. The row keeps its label, owner and name, so its Reconnect button stays. (K13)
8. Temporary: Ren adds 1 to `refresh_failures` and logs. After 3 failures in a row it sends an alert. The status stays `ok`. The next sweep or a 401 tries again. (K14)
9. The token request stops after 10 seconds. That is far less than the 2-minute lease. (U4, S16)
10. Before an `oauth` refresh, Ren reads the server's metadata (kept for 1 hour). When its `issuer` differs from the recorded issuer, Ren sets status `reconnect` and sends no token request. When the metadata cannot be read, Ren uses the recorded token endpoint. (K7)
11. A refresh uses the client auth method that the sign-in used. Public clients use `none`, and every request carries `client_id` (ren-v1 bug 8).
12. When the org app of a credential is archived, Ren does not refresh it. An archive with `force` deletes its credentials (owner-access §11).
13. The sweep refreshes `oauth` and `client_credentials` credentials. A `route` credential has no expiry; Composio renews its account tokens itself (C6). (K15)

## 9. Upstream 401

1. The 401 path exists for tokens that stop working before Ren expects it: tokens with no expiry, and tokens that a provider revokes early (U6).
2. Ren's allow reply lists the refreshable labels of the request with their revisions. Only `oauth`, `client_credentials` and `route` credentials are refreshable. (K16)
3. When the upstream answers 401, the egress:
   1. drops its kept replies for those labels;
   2. returns the 401 to the workload unchanged;
   3. sends `POST /egress/v1/unauthorized` in the background, at most once per label and revision every 60 s per egress copy. (K17)
4. Ren checks the principal and the login as for a resolve. It finds the credential with the workload's lookup order and the label. When the stored revision is newer than the reported one, Ren only clears the caches for the label. (U1, U2, K18)
5. When the revisions match:
   - If `unauthorized_refresh_at` is less than 5 minutes ago, Ren logs and does nothing.
   - If another refresh holds the lease, Ren does nothing.
   - Else Ren sets `unauthorized_refresh_at`, runs the refresher of the credential's type, and saves as in section 8 rule 3. (K18)
6. A 401 never changes the status. Only a fatal refresher answer does (section 8 rule 7). (U5, K18; replaces C46)

7. What each type does after a 401:

   | Type                                  | After a 401                                                                                                                                                                                                                                                                                 |
   | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `oauth`                               | Refresh                                                                                                                                                                                                                                                                                     |
   | `client_credentials`                  | Exchange the client id and secret again (section 10c)                                                                                                                                                                                                                                       |
   | `route` (Composio)                    | A new Composio session for the same account (section 10 rule 11)                                                                                                                                                                                                                            |
   | `REN`, `MODELS` (minted)              | Ren clears the caches for the label. Nothing else.                                                                                                                                                                                                                                          |
   | `key`, `basic`, `fields`              | Nothing. The egress does not report them.                                                                                                                                                                                                                                                   |
   | `oauth`, 403 `insufficient_scope`     | The egress reports it with the challenge's `scope`. Ren adds those scopes to the credential's `wanted_scopes` (at most 64 scopes), changes no status and starts no sign-in. The next reconnect asks for the union of the granted scopes and `wanted_scopes` (MCP 2026-07-28 step-up). (K47) |
   | Other types, 403 `insufficient_scope` | The egress logs the label, the host and the `scope`. Nothing else.                                                                                                                                                                                                                          |

   (K19)

8. The egress does not retry. The workload or the agent sends the request again. An MCP server that failed its connect on a 401 is the brain's work (section 14).
9. A report from an unknown or retired login is ignored.

## 10. Composio

1. `COMPOSIO_API_KEY` stays in Ren. `McpProvider.layerComposio` holds it. Ren starts without it; a Composio connect then fails with `McpProvider.Unavailable`. (P1, P7, A19)
2. Ren finds the auth config at run time: the Composio-managed auth config of the toolkit in the project of `COMPOSIO_API_KEY`, or a new one. Ren keeps the id in memory per process. The catalog holds only the toolkit (`schema/src/mcp.ts:10-16`). (P6, K20)
3. A Composio credential has type `route` and `provider = "composio"`. Its `provider_account_id` is the connected account id. Its sealed value is `{ upstream: session.mcp.url, sessionId }`. Its `hosts` is the host of the session URL. Its inject is `{ op: "route" }`. The owner rules of README §6.4 apply: a person's own account is a `person` credential with `account_user_id` set. (P2, K21)
4. The Composio user id is the credential id (`crd_…`). The connect start chooses it and records it in `oauth_session.credential_id`. Two orgs, two spaces and two connections of one person never share connected accounts. (P3, K22)
5. Connect:
   1. `McpProvider.connect` asks Composio for a Connect Link with the callback `/oauth/callback?state=<state>` (P5).
   2. The person consents.
   3. The callback consumes `state` and reads the connected account until its status is `ACTIVE`, once per second for at most 10 seconds (P4).
   4. Ren creates the session (rule 6) and saves the credential.
   5. When the account is not `ACTIVE` after 10 seconds, the session fails with "Composio did not finish the connection", and Ren starts the cleanup of that account (rule 9). (K23)
6. Session settings:

   | Setting              | Value                             | Why                                                                                                                                              |
   | -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `user_id`            | the credential id                 | Rule 4                                                                                                                                           |
   | `toolkits`           | `{ enable: [<toolkit>] }`         | One app                                                                                                                                          |
   | `auth_configs`       | `{ <toolkit>: <id from rule 2> }` | The project's own auth config                                                                                                                    |
   | `connected_accounts` | `{ <toolkit>: [<account id>] }`   | The session uses exactly the account that Ren shows. Without a pin, Composio picks one at run time (C3, C7).                                     |
   | `manage_connections` | `{ enable: false }`               | The agent gets no tool that creates Connect Links or removes accounts (C4)                                                                       |
   | `workbench`          | `{ enable: false }`               | No Composio code sandbox (C4)                                                                                                                    |
   | `proxy_execute`      | `{ enable: false }`               | No raw authenticated HTTP to the app through Composio                                                                                            |
   | `instant`            | `false`                           | Instant tools run on Composio's provider accounts and charge Ren's Composio balance; omitting the setting turns them on with charges hidden (C8) |

   The search and execute meta tools stay on. A session lists and runs the app's tools through them. (P3, K24)

7. The workload calls `https://<session host>/ren:<LABEL>/…`. The host resolves in the sandbox, and the credential's `hosts` allow it. The egress removes the first path segment, forwards to the session URL, and sets `x-api-key` from `McpProvider.headers()`. (R12, K25; replaces the `.ren.internal` address of README §10 rule 7)
8. Reconnect:
   1. The new consent gives a new connected account for the same Composio user.
   2. Ren creates a new session pinned to it.
   3. Ren saves the new values on the same row (revision + 1) and clears the caches.
   4. Ren starts the cleanup of the old session and the old account, with the ids that it read before the save.

   The old account works until the save. (P8, K26)

9. Delete (a person deletes the credential, offboarding, a space archive; owner-access §11):
   1. Ren reads `sessionId` and `provider_account_id`.
   2. Ren deletes the row and clears the caches.
   3. Ren starts the `DurableRunner` run `composio-cleanup:<account id>` with `{ sessionId, accountId }`. The run deletes the session, then deletes the connected account with `revoke_on_delete=true` (C5).
   4. On a failure the run retries with a backoff from 1 minute to 1 hour between tries. After 24 hours it stops, logs both ids, and sends an alert. (K27)
10. Health: the requirement check reads `McpProvider.status(accountId)`, kept for 5 minutes. A status other than `ACTIVE` gives status `reconnect`. The egress then denies with `credential_reconnect`. (K28)
11. A 401 from the Composio host on a `route` credential runs the `route` refresher. It checks the account status. `ACTIVE`: it creates a new session for the same account, saves it (revision + 1), and starts the cleanup of the old session only. Not `ACTIVE`: the answer is fatal, as in section 8 rule 7. (K29)
12. A `route` credential moves; it is never copied (A7).

## 10a. Connect an app (PR #51)

```
 app (UI)                          Ren                                                        provider
┌───────────────────────────┐    ┌──────────────────────────────────────────────────────┐
│ "Connect Google Workspace" │ ─▶ │ requirements(space, person, app)                      │
│  gmail     [Connect]       │    │  AppResolve.forSpace → the release the space uses     │
│  calendar  [Connect]       │    │  one item per MCP with auth ≠ none, one per env key    │
│  drive     ● Connected     │    │  then the items of each dependsOn app, grouped by app  │
│  GOOGLE_PROJECT_ID [Paste] │    └──────────────────────────────────────────────────────┘
└──────┬────────────────────┘
       │ one click on one item
       ▼
 POST /credentials/connect { owner, target: { kind: "mcp", app, mcp } }
   → oauth_session { app_id, release_id, mcp, state, … } ─────────────────────────────────▶ consent tab
   → GET /oauth/callback → credential { label MCP_<MCP>, app_id, mcp } ◀──────────────────── redirect
 the dialog reads oauth-session.get → complete → reads the requirements again
```

1. The dialog of an app lists one item for each MCP of the app whose auth is not `none`, and one item for each env key in the app's `requiredCredentials`. The release is the one that the space uses: its pin, else the app's latest release (PR #51 `AppQueries.inSpace`). (K33)
2. Below the app's own items, the dialog lists the items of each app in its `dependsOn`, grouped by app. Installing an app installs its dependencies (PR #51 `space/app.ts:46-58`), and the app does not work without their connections. (K35)
3. Each item is one click, one sign-in and one credential. A browser opens a consent tab only on a click, so the dialog cannot run several sign-ins from one click. There is no object that groups the sign-ins of one dialog.
4. An OAuth MCP item runs section 7. A provider MCP item runs section 10. An env key item takes a pasted value (owner-access §9).
5. The connect sets `app_id`, `mcp` and `connection` on the credential. These columns never change. A credential counts for an item only when its `app_id` and `mcp` match the item. A later app that reuses an MCP slug therefore never gets an old credential. (K34)
6. `oauth_session` records `app_id`, `release_id`, `mcp` and `connection` at start. The callback uses the declaration of that release, also when the space moves to another release before the callback.
7. The requirement check compares each MCP credential with the declaration of the release that the space uses. A different type, a host outside the credential's `hosts`, a scope that the credential lacks, or another issuer gives status `reconnect` for that item in that space only. One person credential can be `ok` in one space and `reconnect` in another. (K36)
8. The destination of an item follows owner-access §10 rule 5. A sign-in reaches a person's own account: it sets `account_user_id`. On a space brain the dialog says "Everyone in <space> can use this account" before the sign-in (A41).
9. Uninstalling or archiving an app keeps its credentials (A23). A reinstall finds them through `app_id` and `mcp`.
10. Only `credential.connect` makes labels that start with `MCP_`. `credential.create` refuses them. The egress finds a credential by label and host only, so a pasted `MCP_<MCP>` key would shadow the connected one on its owner's brains while the dialog shows "Connected". Before this ships, the build lists existing rows whose label starts with `MCP_` and that have no `app_id`; each gets status `reconnect`. (K45)

## 10b. Named connections

```
 app release: mcps.meta-ads (one declaration)
   ├── MCP_META_ADS            connection null      (default)  → MCP server "meta-ads"
   ├── MCP_META_ADS__ACME      connection "acme"    "Acme client"   → MCP server "meta-ads__acme"
   └── MCP_META_ADS__GLOBEX    connection "globex"  "Globex client" → MCP server "meta-ads__globex"
 each: its own sign-in, revision and refresh; for Composio its own Composio user and pinned session
```

1. The first credential of an MCP is the default connection: label `MCP_<MCP>`, `connection` null. (K38)
2. A connected MCP item has "Add another account". It asks for a connection slug (at most 58 characters) and a display name, then runs the same flow. The label is `MCP_<MCP>__<CONNECTION>`. (K40)
3. Requirements check the default connection only. Named connections never count as "not connected". Deleting the default while named connections exist shows the item as missing again. A named connection never becomes the default; labels never change (A22). (K38)
4. The MCP server name of a connection is `<mcp>__<connection>`. No slug holds `_`, so it cannot equal another MCP's server name after OpenCode's name cleanup (`opencode/packages/core/src/tool/mcp.ts:16`). This changes owner-access §6 rule 3. (K37)
5. The agent tells connections apart by the credential's display name (`name`), for example "Meta Ads: Acme client". No account email reaches the agent's context (ren-v1 `e079544f3`). (K39)
6. Each Composio connection is its own credential, so its own Composio user (K22) and its own pinned session.
7. Owners do not add up to more connections. A person `MCP_META_ADS__ACME` shadows a space `MCP_META_ADS__ACME` on that person's session brain (lookup order, C5).
8. On a space brain every chat can call every connection (C7). To keep two clients apart, use two spaces.
9. Same account twice: a provider can approve the login that is already open in the browser, so a second connection can hold the first one's account. When the token answer or the server's userinfo gives an account id (OIDC `sub` or a profile id), Ren stores its SHA-256 hash in `credential.account_subject_hash`. After a callback, a match with another connection of the same MCP and owner completes the sign-in with the warning "This is the same account as <display name>", and the dialog offers to delete the new connection. Without an account id there is no check. Ren sends no extra "choose account" parameter. (K41)
10. One provider login can reach many client accounts (Meta Business Manager, Google Ads manager accounts). Then the client is a tool argument, and one connection is enough. Each app's setup guide says when a second connection makes sense; this spec has no rule for it.

Walkthrough (space `agency`, space brain, app `meta-ads`):

| Step | Person                                                                                                                                                             | Ren                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1    | Clicks Connect on the Meta Ads item. Owner: space (a space brain offers space or org). Sees "Everyone in agency can use this account". Display name "Acme client". | One sign-in → `MCP_META_ADS`, owner space, name "Acme client".                                                 |
| 2    | Clicks "Add another account". Connection `globex`, display name "Globex client".                                                                                   | One sign-in → `MCP_META_ADS__GLOBEX`. Account check of rule 9.                                                 |
| 3    | Asks the agent to pause a Globex campaign.                                                                                                                         | The brain has servers `meta-ads` ("Meta Ads: Acme client") and `meta-ads__globex` ("Meta Ads: Globex client"). |
| 4    | Reconnects Globex, or deletes Acme.                                                                                                                                | Only that row changes. Deleting the default shows the item as "not connected"; Globex keeps working.           |

Meta's official MCP with a borrowed client that returns to `127.0.0.1` needs `oauth-session.complete`, which is not built.

## 10c. Client credentials

A client-credentials credential reaches an app's own account with no person signing in (RFC 6749 §4.4). Example: Shopify issues no admin-created tokens since 2026 (ren-v1 `7ac0b76a1`); a store owner gets a client id and secret, and someone must exchange them at `https://<store>.myshopify.com/admin/oauth/access_token` (REN-1198).

```
 person pastes                       Ren                                                  token endpoint
┌──────────────────────────┐ create ┌──────────────────────────────────────────────┐    ┌─────────────────────┐
│ client id, client secret  │ ─────▶ │ exchange once: grant_type=client_credentials  │ ─▶ │ POST token endpoint │
│ token endpoint (or store) │        │ seal { id, secret, endpoint, accessToken }    │ ◀─ │ access_token,       │
│ hosts                     │        │ expires_at from expires_in                    │    │ expires_in          │
└──────────────────────────┘        └──────────────────────┬───────────────────────┘    └─────────────────────┘
                                                           │ sweep 20 min before expiry, or after a 401: exchange again
                                                           ▼
                                          egress injects the access token for ren:<LABEL>
```

1. `credential.create` takes the client id, the secret, the token endpoint, the auth method (default `client_secret_post`) and optional scopes. Ren exchanges once before it saves. A failed exchange fails the create with the provider's error code. (K42)
2. The owner is `space` or `org`, never `person`: the account is the app's, not a person's (README §6.4 table). There is no `account_user_id`. It moves; it is never copied (A7).
3. The token answer follows section 7 rule 10. No `expires_in` means no expiry; only a 401 renews such a token.
4. The refresher exchanges again with the stored id and secret. It follows section 8: the same lease, the revision-checked write, the cache clear. `invalid_client` or `unauthorized_client` with HTTP 400 or 401 is fatal: status `reconnect` (the secret was rotated). A person fixes it with `credential.rotate` and a new secret. (K43)
5. The workload sees `<LABEL>=ren:<LABEL>`, as for a key (A35). The inject is the declaration's (for Shopify: `replace` in the header `X-Shopify-Access-Token`).
6. The token request follows section 7 rule 15 (public HTTPS, no redirect, 10 s, 1 MiB) and sends the secret only to the stored token endpoint.

## 11. Lifecycle states

| State                         | What happens                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brain asleep                  | The sweep keeps renewing tokens. Nothing in the brain changes.                                                                                                                                                                                   |
| Brain waking                  | The first requests resolve the current revision.                                                                                                                                                                                                 |
| Brain mid-turn: sweep refresh | The cache clear makes the next request resolve again. A request that used the old token still gets a valid answer, because the old token works until its expiry.                                                                                 |
| Brain mid-turn: early revoke  | One request gets 401. The report refreshes the token in about 1 s. The next request works.                                                                                                                                                       |
| Brain mid-turn: fatal refresh | The next request gets 403 `credential_reconnect` with the label.                                                                                                                                                                                 |
| Ren down                      | The sweep stops. The egress serves kept replies up to 15 minutes, never after the token's expiry (C37). The lead of 20 minutes leaves each kept token at least 15 minutes. Reports are lost; the next sweep or 401 after Ren returns catches up. |
| Ren restarts during a sign-in | `oauth_session` is in Postgres. A callback within 10 minutes completes.                                                                                                                                                                          |
| Ren restarts during a refresh | The lease expires after 2 minutes. The next sweep tries again. A spent refresh token can be lost only if the provider rotated it and Ren stopped before the write; the next refresh then fails as fatal and the row shows Reconnect.             |
| Egress restarts               | Its kept replies and its 60 s report limit are gone. The next request resolves again.                                                                                                                                                            |
| Workload replaced             | Reports from the old login are ignored.                                                                                                                                                                                                          |
| Composio down                 | Composio MCP calls fail. Connects fail. Cleanup runs retry for up to 24 hours. Other credentials work.                                                                                                                                           |
| OAuth server down             | Refreshes fail as temporary. Tokens work until their expiry.                                                                                                                                                                                     |

## 12. Edge cases

| #   | Case                                                                                                     | Rule                                                                                                                                                                                                            | Evidence                                              |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | A request with token revision 3 is in flight while the sweep saves revision 4. It comes back 401.        | Revision check: Ren clears caches only. No refresh, no status change.                                                                                                                                           | U1, U2                                                |
| 2   | 50 parallel requests get 401 for the same token.                                                         | One report per label and revision per 60 s per egress copy. One refresh per 5 minutes.                                                                                                                          | —                                                     |
| 3   | An endpoint answers 401 for a reason other than the token.                                               | At most one refresh per 5 minutes. The status never changes from a 401.                                                                                                                                         | cloudflare-os `gatekeeper-kit/src/credentials.ts:705` |
| 4   | A person reconnects while the sweep refreshes the old grant.                                             | The sweep's write matches no row (revision changed). The reconnect wins.                                                                                                                                        | U3                                                    |
| 5   | The provider rotates the refresh token, and the answer also fails an ID-token check.                     | Save the rotated token first.                                                                                                                                                                                   | ren-v1 bug 6                                          |
| 6   | A 503 answer whose body holds `invalid_grant`.                                                           | Temporary: only 400 and 401 can be fatal.                                                                                                                                                                       | S14                                                   |
| 7   | An error body `{ "error": { … } }`.                                                                      | Read the code from the object. An unknown code is temporary.                                                                                                                                                    | S15                                                   |
| 8   | A server's metadata names a new issuer after the sign-in.                                                | No refresh; status `reconnect`.                                                                                                                                                                                 | K7                                                    |
| 9   | The token endpoint answers with a redirect.                                                              | Ren does not follow it. The refresh fails as temporary.                                                                                                                                                         | S16                                                   |
| 10  | Metadata sits below the root (Shopify `/auth`).                                                          | Path-aware discovery.                                                                                                                                                                                           | S1                                                    |
| 11  | A server's metadata lists PKCE methods without S256.                                                     | The connect fails before consent.                                                                                                                                                                               | K8                                                    |
| 12  | A provider sends `expires_in: "3600"`.                                                                   | Read as 3600.                                                                                                                                                                                                   | K6                                                    |
| 13  | A token without a refresh token and with an expiry.                                                      | Accepted. Status `reconnect` at expiry.                                                                                                                                                                         | K6                                                    |
| 14  | A sign-in `state` is used twice.                                                                         | The second callback fails with `OAuth.StateInvalid { used }`.                                                                                                                                                   | ren-v1 bug 13                                         |
| 15  | The callback's `iss` differs from the recorded issuer.                                                   | The session fails.                                                                                                                                                                                              | K7                                                    |
| 16  | Composio is slow to mark the account `ACTIVE`.                                                           | Poll for 10 seconds.                                                                                                                                                                                            | P4                                                    |
| 17  | A person reconnects Gmail with another Google account.                                                   | The new account is pinned. The old one is cleaned up after the save.                                                                                                                                            | C3                                                    |
| 18  | The agent asks Composio for a Connect Link in chat.                                                      | `manage_connections` is off; the tool does not exist.                                                                                                                                                           | C4                                                    |
| 19  | The person revokes Ren's access in their Google account.                                                 | The account leaves `ACTIVE`. The requirement check shows Reconnect within 5 minutes.                                                                                                                            | C6, K28                                               |
| 20  | `COMPOSIO_API_KEY` changes to another project.                                                           | Auth config ids resolve again at run time. Existing sessions belong to the old project and fail with 401; the `route` refresher finds the account not `ACTIVE` in the new project, and the row shows Reconnect. | P6, K20                                               |
| 21  | The cleanup at Composio fails for more than 24 hours.                                                    | The run stops, logs the ids and alerts.                                                                                                                                                                         | K27                                                   |
| 22  | A request holds `ren:MCP_GMAIL` with `:` encoded as `%3A` in the path.                                   | The `route` op removes both forms.                                                                                                                                                                              | C43                                                   |
| 23  | The workload sends `backend.composio.dev/ren:MCP_GMAIL` while the credential has status `reconnect`.     | 403 `credential_reconnect` with the label.                                                                                                                                                                      | K13                                                   |
| 24  | Space S uninstalls app A (MCP `calendar`). Later app B with an MCP also named `calendar` is installed.   | The old credential has A's `app_id`; it does not count for B's item. B's item shows "not connected".                                                                                                            | K34                                                   |
| 25  | Space A pins release 1; space B follows release 2, where calendar has a new host. One person credential. | `ok` in space A, `reconnect` in space B.                                                                                                                                                                        | K36                                                   |
| 26  | The space moves to a new release while a sign-in is open.                                                | The callback uses the release recorded at start. The requirement check then compares with the new release.                                                                                                      | §10a rule 6                                           |
| 27  | MCP `gmail` gets connection `work`, and another app has an MCP `gmail-work`.                             | Server names `gmail__work` and `gmail-work` differ.                                                                                                                                                             | K37                                                   |
| 28  | A space has only named Meta Ads connections; an app skill calls `tools.meta-ads.…`.                      | The item shows "not connected" until a default connection exists.                                                                                                                                               | K38                                                   |
| 29  | A person deletes the default connection while named ones exist.                                          | The item shows "not connected". No named connection becomes the default.                                                                                                                                        | K38, A22                                              |
| 30  | "Add another account" and the browser is still logged in to the first account at the provider.           | The account hashes match; the sign-in completes with "This is the same account as <name>".                                                                                                                      | K41                                                   |
| 31  | A person pastes a key with the label `MCP_META_ADS` while the space has a connected `MCP_META_ADS`.      | `credential.create` refuses the label.                                                                                                                                                                          | K45                                                   |

## 13. Changes to earlier decisions

| Earlier                                                                                    | Now                                                                                                  | Why                                                                                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| C46: a 401 after a fresh refresh marks the credential `reconnect`                          | Section 9 rules 4–6 (K18)                                                                            | In-flight requests with an old token, and 401s for other reasons (U1, U2)                            |
| README §6.9 rule 4 and `OAuth.NoRefreshToken`                                              | Section 7 rules 10 and 11 (K6)                                                                       | RFC 6749 §5.1; ren-v1, OpenCode, Codex, cloudflare-os and multica accept it                          |
| owner-access §11: a fatal refresh deletes the credential                                   | Status `reconnect`; the row stays (K13)                                                              | The label, owner and connection name stay; the Reconnect button has a row                            |
| README §10 rule 7 and C26: the `.ren.internal` placeholder host                            | The first path segment on the provider's real host (K25)                                             | The name does not resolve in the sandbox (C49)                                                       |
| A19, A36: Composio                                                                         | Section 10 (K20–K29)                                                                                 | User id per credential, pinned account, session settings, cleanup                                    |
| owner-access §6 rule 3: server name `<slug>-<connection>`                                  | `<mcp>__<connection>` (K37)                                                                          | `gmail` + `work` equals an MCP slug `gmail-work`; OpenCode silently replaces tools whose names clash |
| owner-access A12, A13: the label alone ties a credential to its MCP                        | Columns `app_id`, `mcp`, `connection` (K34)                                                          | A later app can reuse an MCP slug after an uninstall                                                 |
| C10: the egress calls Ren over gRPC                                                        | HTTP with mTLS (`/egress/v1/*`)                                                                      | As built (`repos/iron-proxy/internal/ren/client.go:266,323`)                                         |
| `CredentialRefresh`: lead 10 minutes, the refresher writes, no cache clear after a success | Lead 20 minutes, the sweep writes with the revision check, caches cleared after each save (K11, K12) | C37; U3                                                                                              |

## 14. Open

| Item                                                                                                                                                                                                                                                                                  | Owner or needed by                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| MCP servers in OpenCode: the entries, the pull contract, `oauth: false`, `x-ren-revision` (C52)                                                                                                                                                                                       | The OpenCode work (another person) |
| For that work: reconnect each Ren-managed MCP server in status `failed` or `needs_auth` when a turn starts, and retry it 10 s, 1 min and 5 min after it fails. Without this, a server whose connect got a 401 stays down (`opencode/packages/core/src/mcp/index.ts:425-428,518-524`). | The OpenCode work                  |
| For that work: a requirement status `unavailable` for an MCP that needs a credential on a brain without the egress (C53)                                                                                                                                                              | The OpenCode work                  |
| For that work: the MCP server name is `<mcp>` for a default connection and `<mcp>__<connection>` for a named one; its description carries the credential's display name, never an account email                                                                                       | The OpenCode work                  |
| For that work: refuse an MCP tool whose OpenCode id (`<namespace>_<tool>`) another server already holds, and log both servers. OpenCode replaces such tools silently (`opencode/packages/core/src/tool.ts:185-186`)                                                                   | The OpenCode work                  |
| Ren MCP's connect elicitation (PR #52, "Not in this PR") marks `credential.connect` and `oauth-session.get` as `Mcp.Tool`: connect returns a redirect URL, and the session can be polled                                                                                              | Ren MCP phase 2                    |
| Check whether `@better-auth/cimd/node` (PR #52, pinned DNS lookup) can serve the guarded requests of K31 before writing a new one                                                                                                                                                     | Step 5 of the build                |

No move of ren-v1 credentials to v2 is planned (E13). The facts for a future move are in [`references/connections.md`](references/connections.md) §8.

## 15. Tests

Write each test first. Each test must fail before its change. No mocks: real Postgres, real `Envelope.layerLocal`, a local OAuth authorization server in `core/test/lib`, a local Composio server at the wire level in `core/test/lib` (prior art: ren-v1 `test/fixture/composio-server.ts`, `3f0282774`), and the egress fork with local HTTPS upstreams.

| #   | Package and file                             | Test                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `core/test/credential-refresh.test.ts`       | Under `TestClock`: a token that expires in 19 minutes is refreshed; one in 21 minutes is not. The save raises `revision` and clears the egress caches.                                                                                                                 |
| 2   | `core/test/credential-refresh.test.ts`       | A reconnect saves while a refresh runs. The refresh result is dropped. The stored value is the reconnect's.                                                                                                                                                            |
| 3   | `core/test/credential-refresh.test.ts`       | A fatal answer (400 `invalid_grant`) sets status `reconnect`, clears the value and keeps the row. A 503 with `invalid_grant` in the body is temporary. `{ "error": { "code": "x" } }` is temporary.                                                                    |
| 4   | `core/test/credential-refresh.test.ts`       | 3 temporary failures in a row send an alert. The status stays `ok`.                                                                                                                                                                                                    |
| 5   | `core/test/credential-refresh.test.ts`       | An answer without `refresh_token` keeps the old one. A rotated token is saved when the ID-token check fails.                                                                                                                                                           |
| 6   | `core/test/credential-refresh.test.ts`       | A token with an expiry and no refresh token gets status `reconnect` at its expiry. A token with no expiry is never selected.                                                                                                                                           |
| 7   | `core/test/credential-refresh.test.ts`       | The server's metadata names another issuer: no token request, status `reconnect`.                                                                                                                                                                                      |
| 8   | `core/test/oauth.test.ts`                    | Discovery: `resource_metadata` from `WWW-Authenticate`; path-inserted metadata; root fallback; OpenID Connect fallback; the declared endpoints only when no metadata exists.                                                                                           |
| 9   | `core/test/oauth.test.ts`                    | Client order: org app, borrowed client, metadata document, registration. A borrowed client and a static org app skip discovery.                                                                                                                                        |
| 10  | `core/test/oauth.test.ts`                    | Scope order. `resource` from the metadata, else the MCP URL; a refresh sends the same `resource`.                                                                                                                                                                      |
| 11  | `core/test/oauth.test.ts`                    | PKCE: methods without S256 refuse the connect; a missing list is accepted; S256 is always sent.                                                                                                                                                                        |
| 12  | `core/test/oauth.test.ts`                    | Token answers: no refresh token accepted; `expires_in: "3600"` read; a 2xx answer with `error` fails; `token_type: "DPoP"` fails; no `expires_in` gives no expiry.                                                                                                     |
| 13  | `core/test/oauth.test.ts`                    | Callback: `state` used twice fails; a wrong `iss` fails when the server supports it; a provider `error` fails with its description; a reconnect keeps the old value until the save.                                                                                    |
| 14  | `core/test/egress.test.ts`                   | The allow reply lists `oauth` and `route` labels in `refreshable` with their revisions, and no `key` label. A `reconnect` credential is denied with `credential_reconnect`.                                                                                            |
| 15  | `core/test/egress.test.ts`                   | `unauthorized`: an older revision only clears caches; the same revision refreshes once; a second report within 5 minutes does nothing; a 401 never changes the status; a retired login is ignored.                                                                     |
| 16  | `core/test/egress.test.ts`                   | `unauthorized` on `REN` and `MODELS` clears caches only.                                                                                                                                                                                                               |
| 17  | `repos/iron-proxy/internal/ren/*_test.go`    | On a 401 the egress drops its kept replies for the refreshable labels, returns the 401, and sends one report for 10 parallel 401s with one revision. A 403 `insufficient_scope` is logged and not reported.                                                            |
| 18  | `repos/iron-proxy/internal/ren/scan_test.go` | `route` with `placeholder` removes `/ren:MCP_GMAIL` and `/ren%3AMCP_GMAIL` and keeps the rest of the path and the query.                                                                                                                                               |
| 19  | `server/test/egress.slow.test.ts`            | End to end: an upstream with an OAuth credential answers 401 once. The workload's next request gets the refreshed token.                                                                                                                                               |
| 20  | `core/test/mcp-provider.test.ts`             | Composio connect: the session has the settings of section 10 rule 6; the Composio user id is the credential id; the account is pinned; an account that stays `INITIATED` for 10 s fails the connect and starts its cleanup.                                            |
| 21  | `core/test/mcp-provider.test.ts`             | Auth config: found or created at run time for the toolkit, then kept in memory.                                                                                                                                                                                        |
| 22  | `core/test/mcp-provider.test.ts`             | Reconnect: the new account is saved before the old session and account are deleted. Delete: the cleanup run deletes the session and the account with `revoke_on_delete=true`; under `TestClock` it stops after 24 hours of failures and alerts.                        |
| 23  | `core/test/mcp-provider.test.ts`             | Health: an account in status `EXPIRED` gives status `reconnect`; the status read is kept for 5 minutes. A 401 from Composio with an `ACTIVE` account creates a new session and cleans up only the old session.                                                         |
| 24  | `core/test/egress.test.ts`                   | A `route` credential of provider `composio` gets `route` with `placeholder` and `setHeader x-api-key`. The sandbox-facing URL holds no session URL and no key.                                                                                                         |
| 25  | `core/test/credential-requirements.test.ts`  | An app's items: one per MCP with auth other than `none`, one per env key, then each `dependsOn` app's items grouped by app. The release is the space's pin, else the latest.                                                                                           |
| 26  | `core/test/credential-requirements.test.ts`  | A credential with another `app_id` does not satisfy an item with the same MCP slug. A person credential is `ok` in a space on release 1 and `reconnect` in a space on release 2 with a new host.                                                                       |
| 27  | `core/test/oauth.test.ts`                    | A sign-in records `app_id`, `release_id`, `mcp` and `connection`; the callback uses that release after the space moves to a newer one; the credential gets `app_id`, `mcp` and `connection`.                                                                           |
| 28  | `core/test/credential-requirements.test.ts`  | Named connections: `MCP_META_ADS__ACME` does not satisfy the item; only `MCP_META_ADS` does. A connection slug of 59 characters is refused.                                                                                                                            |
| 29  | `core/test/oauth.test.ts`                    | A second connection whose token answer has the same `sub` as the default completes with the same-account warning; a different `sub` completes without it; no `sub` makes no check. The hash, not the id, is stored.                                                    |
| 30  | `core/test/credentials.test.ts`              | Under `TestClock`: a `client_credentials` create exchanges once; two requests at once make one exchange; the sweep exchanges again 20 minutes before expiry; `invalid_client` sets `reconnect`; a rotate with a new secret sets `ok`; owner `person` is refused.       |
| 31  | `core/test/credentials.test.ts`              | `credential.create` with the label `MCP_GMAIL` fails; `credential.connect` for MCP `gmail` makes `MCP_GMAIL`.                                                                                                                                                          |
| 32  | `core/test/oauth.test.ts`                    | `iss` table: each of the four rows; a mismatched `iss` with an `error` shows no provider text. `offline_access` is asked for only when listed. A 403 `insufficient_scope` report adds to `wanted_scopes`, keeps the status, and the next reconnect asks for the union. |
| 33  | `server/test/oauth-client.slow.test.ts`      | Ren's OAuth client signs in to Ren's own `/mcp` (PR #52): 401 challenge, discovery, client metadata document, `iss`, token, then a refresh.                                                                                                                            |
| 34  | live, skipped without `COMPOSIO_API_KEY`     | Connect Gmail through Composio, call one tool through the egress, delete the credential, and check that the account is gone at Composio. Ask the user first.                                                                                                           |

## 16. Decisions

| ID  | Decision                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | Scope: OAuth sign-in, the refresh job and credential management, Composio as an MCP provider, client credentials, the upstream 401 refresh, and connecting an app of PR #51 with named connections. MCP servers in OpenCode are another person's work.   |
| K2  | `OAuth` uses the MCP SDK inside Effect (A17).                                                                                                                                                                                                            |
| K3  | `OAuthApps` is built in this spec, as owner-access §7.                                                                                                                                                                                                   |
| K4  | `oauth-session.complete` is in the contract and not built.                                                                                                                                                                                               |
| K5  | Token answers: `expires_in` as a number or a numeric string; a 2xx answer with `error` and no `access_token` is an error; `token_type` Bearer only; a refresh answer without `refresh_token` or `scope` keeps the old values.                            |
| K6  | A refresh token is optional (`OAuth.NoRefreshToken` goes). No `expires_in` means no expiry. A token with an expiry and no refresh token gets `reconnect` at expiry. Google's `access_type=offline` and `prompt=consent` are parameters of that provider. |
| K7  | Issuer binding: Ren records the issuer, refreshes only at the recorded token endpoint, and sets `reconnect` when the issuer changes. The callback checks `iss` by the MCP 2026-07-28 table, before it uses anything else of the answer.                  |
| K8  | PKCE: always S256; refuse only when the server lists methods without S256. A missing list is accepted, which differs from the MCP spec.                                                                                                                  |
| K9  | Live discovery first. Declared endpoints are a fallback and become optional. A static org app and a borrowed client use their own endpoints.                                                                                                             |
| K10 | `resource` comes from the protected-resource metadata, else the MCP URL. Sign-in always sends it; each refresh sends exactly the same value.                                                                                                             |
| K11 | A refresher returns the new value. The sweep writes with `WHERE revision = <read>`, raises `revision`, and clears the egress caches after each save.                                                                                                     |
| K12 | The sweep refreshes 20 minutes before expiry.                                                                                                                                                                                                            |
| K13 | A fatal refresh answer sets status `reconnect`, clears the value and keeps the row. The egress denies with `credential_reconnect`.                                                                                                                       |
| K14 | Temporary refresh failures: logs, and an alert after 3 in a row. No status change.                                                                                                                                                                       |
| K15 | This spec builds the `oauth`, `client_credentials` and `route` refreshers.                                                                                                                                                                               |
| K16 | The allow reply carries `refreshable: [{ label, revision }]` for `oauth` and `route` labels.                                                                                                                                                             |
| K17 | On a 401 the egress drops its kept replies for those labels, returns the 401, and reports in the background to `POST /egress/v1/unauthorized`, at most once per label and revision every 60 s per copy.                                                  |
| K18 | Ren acts on a report only when the revision matches, at most once per credential per 5 minutes, under the refresh lease. A 401 never changes the status.                                                                                                 |
| K19 | After a 401: `oauth` refreshes; `route` gets a new session; `REN` and `MODELS` clear caches; `key`, `basic`, `fields` do nothing. A 403 `insufficient_scope` on `oauth` is K47; on other types it is logged only.                                        |
| K20 | The Composio auth config is found or created at run time for the toolkit and kept in memory. The catalog holds no auth config id.                                                                                                                        |
| K21 | A Composio credential: type `route`, columns `provider` and `provider_account_id`, sealed `{ upstream, sessionId }`, `hosts` from the session URL.                                                                                                       |
| K22 | The Composio user id is the credential id, chosen at connect start.                                                                                                                                                                                      |
| K23 | The Composio callback waits for `ACTIVE` for at most 10 seconds.                                                                                                                                                                                         |
| K24 | Composio sessions: one toolkit, pinned account, `manage_connections`, `workbench` and `proxy_execute` off, `instant: false`.                                                                                                                             |
| K25 | The workload names a Composio credential by the first path segment `ren:<LABEL>` on Composio's real host. `route` carries `placeholder` and the egress removes it.                                                                                       |
| K26 | A Composio reconnect saves the new account before it cleans up the old session and account.                                                                                                                                                              |
| K27 | Cleanup at Composio is a `DurableRunner` run with a backoff from 1 minute to 1 hour, stopped after 24 hours with an alert. It deletes with `revoke_on_delete=true`.                                                                                      |
| K28 | The requirement check reads the Composio account status, kept for 5 minutes. Not `ACTIVE` gives `reconnect`.                                                                                                                                             |
| K29 | A 401 from Composio with an `ACTIVE` account creates a new session for the same account. A not `ACTIVE` account is a fatal answer.                                                                                                                       |
| K30 | `credential` gains `revision`, `provider`, `provider_account_id`, `oauth_app_id` and `unauthorized_refresh_at`. `oauth_session` gains `issuer` and `credential_id`. No Composio table.                                                                   |
| K31 | Every request of a sign-in and a refresh goes to a public HTTPS address only, follows no redirect, stops after 10 seconds, and reads at most 1 MiB.                                                                                                      |
| K32 | The sweep and the 401 path use one refresher per type, one lease and one write.                                                                                                                                                                          |
| K33 | An app's connect dialog has one item per MCP with auth other than `none`, and one per env key of the app, from the release that the space uses. One click, one sign-in, one credential per item.                                                         |
| K34 | MCP credentials carry `app_id`, `mcp` and `connection`, set at connect and never changed. A credential counts for an item only when `app_id` and `mcp` match.                                                                                            |
| K35 | An app's dialog also lists the items of its `dependsOn` apps, grouped by app.                                                                                                                                                                            |
| K36 | The requirement check compares an MCP credential with the release that the space uses. A mismatch of type, host, scopes or issuer gives `reconnect` in that space only.                                                                                  |
| K37 | The MCP server name of a named connection is `<mcp>__<connection>`.                                                                                                                                                                                      |
| K38 | The first credential of an MCP is the default connection (`MCP_<MCP>`). Requirements check only the default. A named connection is never promoted.                                                                                                       |
| K39 | The agent tells connections apart by the credential's display name only. No account email.                                                                                                                                                               |
| K40 | A connection slug has at most 58 characters, so `MCP_<MCP>__<CONNECTION>` fits in 128.                                                                                                                                                                   |
| K41 | Same account twice: Ren stores a SHA-256 hash of the provider account id when one is given, and warns when a new connection of the same MCP and owner matches another. No extra authorize parameter.                                                     |
| K42 | Client credentials are built in this spec: create exchanges once, owner space or org, the value holds id, secret, endpoint and token.                                                                                                                    |
| K43 | The `client_credentials` refresher exchanges again; `invalid_client` or `unauthorized_client` with 400 or 401 is fatal.                                                                                                                                  |
| K44 | The 401 report is `egress.unauthorized` in `@ren/egress-api`, beside `resolve`, with the same caller check. Customer proxies use it once registered keys exist.                                                                                          |
| K45 | The `MCP_` label prefix is reserved for `credential.connect`. `credential.create` refuses it. Existing `MCP_` rows without `app_id` get status `reconnect`.                                                                                              |
| K46 | Sign-in asks for `offline_access` when the server lists it in `scopes_supported`.                                                                                                                                                                        |
| K47 | A 403 `insufficient_scope` on an `oauth` credential adds the challenged scopes to `wanted_scopes`, with no status change and no sign-in. The next reconnect asks for the union.                                                                          |
| K48 | `Credential.Info` adds `app`, `mcp`, `connection` and `provider`; `revision`, `provider_account_id`, `account_subject_hash`, `unauthorized_refresh_at` and `wanted_scopes` stay internal.                                                                |
