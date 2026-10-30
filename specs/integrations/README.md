# Managed MCPs: pending

Not built. Linear REN-1540.

An app can have two MCPs: the vendor's **official MCP**, which runs on the organization's own account, and a **managed MCP**, which runs on Ren's account and is paid with Ren credits. When a space has the app but no connected account for the official MCP, Ren gives the brain the managed MCP. When someone connects an account, the official MCP replaces the managed one in the running brain, without a restart.

The managed MCPs run in the **integrations service** (integrations repository, `service/`, ECS service `mcp`), next to billing and the partner MCPs, at `https://mcp.useren.ai/managed/<server>/mcp`. The first managed MCP is Kernel (cloud browsers). It forwards to Kernel's own MCP server.

References:

- Provider facts and sources: [references/providers.md](references/providers.md).
- What billing must change for correction rows: [references/billing.md](references/billing.md).

## 1. Mental model

### 1.1 Which MCP a space gets

Asha's space `spc_G` has the app Kernel. Its profile "Main" lists `spc_G`. The profile has one item, the official MCP `kernel` (OAuth). Nobody has signed in, so the item has no credential.

```
 ┌──────────────────────┐                          ┌──────────────────────┐                          ┌──────────────────────┐
 │                      │                          │                      │                          │                      │
 │  space spc_G         │  resolved: official      │  select()            │  pull reply              │  brain brn_7         │
 │  profile "Main" of   │  servers found (none)    │  core/src/app/       │  catalog.mcps:           │  OpenCode connects   │
 │  app kernel          │  managed: kernel-managed │  selection.ts        │  kernel-managed          │  kernel-managed      │
 │  no credential       │  ──────────────────────> │                      │  ──────────────────────> │                      │
 │                      │                          │                      │                          │                      │
 └──────────────────────┘                          └──────────────────────┘                          └──────────────────────┘
```

| State of the app in the space                                 | Server the brain gets     | Who pays                 |
| ------------------------------------------------------------- | ------------------------- | ------------------------ |
| A reached profile has a credential for `kernel`               | `kernel__main` (official) | The org's Kernel account |
| A reached profile has the app, but no credential for `kernel` | `kernel-managed`          | Ren credits              |
| No reached profile of the app                                 | None                      | —                        |

### 1.2 One call

The agent calls the Kernel tool `manage_browsers` with `action: "create"`. The brain is `brn_7`, generation 3. The chat is `ses_4`. Asha (`mem_A`) sent the turn.

```
 ┌──────────────────────┐                          ┌──────────────────────┐                          ┌──────────────────────┐
 │                      │                          │                      │                          │                      │
 │  brain brn_7:3       │  POST /managed/          │  egress              │  Bearer <signed token>   │  /managed/kernel/mcp │
 │  OpenCode MCP client │  kernel/mcp              │  replaces both       │  ren-member: mem_A       │  1 renToken          │
 │                      │  Bearer ren:INTEGRATIONS │  placeholders        │  _meta session: ses_4    │  2 credit check      │
 │                      │  ren-root-session: ses_4 │                      │  ──────────────────────> │  3 add tags          │
 │                      │  ren-member:             │                      │                          │                      │
 │                      │  ren:PERSON.mem_A        │                      │                          │                      │
 │                      │  ──────────────────────> │                      │                          │                      │
 │                      │                          │                      │                          │                      │
 └──────────────────────┘                          └──────────────────────┘                          └──────────────────────┘

 ┌──────────────────────┐                          ┌──────────────────────┐
 │                      │                          │                      │
 │  /managed/kernel/mcp │  same MCP request,       │  mcp.onkernel.com    │
 │  forwardMcp          │  tags ren_session ...    │  Kernel's MCP server │
 │                      │  Bearer <spc_G's Kernel  │  project ren-spc_G   │
 │                      │  key>                    │                      │
 │                      │  ──────────────────────> │                      │
 │                      │  session_id abc          │                      │
 │                      │                          │                      │
 └──────────────────────┘                          └──────────────────────┘

 ┌──────────────────────┐                          ┌──────────────────────┐                          ┌──────────────────────┐
 │                      │                          │                      │                          │                      │
 │  usage loop, 60 s    │  GET /browsers           │  Kernel API          │  abc deleted, ready:     │  Ren ingest route    │
 │  each space project  │  status=deleted          │                      │  api.call kernel:abc     │  usage_event         │
 │                      │  X-Kernel-Project-Id     │                      │  tags → session, member  │  a repeat is ignored │
 │                      │  ──────────────────────> │                      │  ──────────────────────> │                      │
 │                      │                          │                      │                          │                      │
 └──────────────────────┘                          └──────────────────────┘                          └──────────────────────┘
```

1. The brain holds no key. It sends `ren:INTEGRATIONS`. The egress replaces it with a token that Ren signed for `brn_7:3`. The egress replaces `ren:PERSON.mem_A` with `mem_A` only when Asha can send in `spc_G`.
2. The service checks the token with Ren's public keys. The token gives `org_P`, `spc_G`, `brn_7` and generation 3. The brain cannot change them.
3. The service reads `billing.gate_allowed` for `org_P`.
4. The service adds the tags `ren_session: ses_4`, `ren_root_session: ses_4`, `ren_member: mem_A`, `ren_brain: brn_7` to the create, and forwards the call to Kernel's MCP server with the Kernel key of `spc_G`. That key works only in the Kernel project `ren-spc_G`.
5. After Kernel deletes browser `abc` and its usage is final, the loop sends one `api.call` row. Billing reads it from `usage_event`.

### 1.3 How each request is authenticated

The brain never holds a secret. It sends a placeholder. The egress asks Ren for the value (`schema/src/injection.ts`) and replaces it.

| Path                | The brain sends               | The egress puts in                                                | The receiver checks                            |
| ------------------- | ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Official vendor MCP | `Bearer ren:MCP_KERNEL__MAIN` | The OAuth token of the profile's credential                       | The vendor                                     |
| Ren's MCP           | `Bearer ren:REN`              | A token that Ren signs for the brain                              | Ren, offline                                   |
| Models              | `Bearer ren:MODELS`           | A LiteLLM key that the Ren Inference Service minted for the brain | LiteLLM, in its database                       |
| Managed MCP (new)   | `Bearer ren:INTEGRATIONS`     | A token that Ren signs for the brain, purpose `ren-integrations`  | The integrations service, offline (`renToken`) |

The managed path copies the model path: placeholder, egress, receiver, upstream with the receiver's own key. The token is signed by Ren, as for `REN`, not minted inside the receiver as for LiteLLM: the receiver keeps no state for each brain, and the token expires in 1 h. The `REN` token is not reused, because Ren accepts it: the integrations service could then act as the brain at Ren. A separate purpose with separate keys works only at its receiver.

### 1.4 Where each field of a Kernel usage row comes from

| Usage row field                  | Comes from                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization`, `space`          | The row of the space's Kernel project (`managed.kernel_space`), written from the token                                                              |
| `brain`, `workload`              | Browser tag `ren_brain` (from the token of the call that created the browser)                                                                       |
| `session`                        | Browser tag `ren_session`, from `_meta["ai.opencode/sessionID"]` of that call (`opencode/packages/core/src/mcp/client.ts:394`, in Ren's pin 2.0.27) |
| `root_session`, `member`         | Browser tags `ren_root_session`, `ren_member`, from the headers of that call                                                                        |
| `turn`, `agent`                  | Empty. An MCP call does not carry them.                                                                                                             |
| `cost_micro_usd`, `time`, `data` | Kernel: `usage.uptime_ms`, `memory`, `gpu`, `deleted_at` (§6.5)                                                                                     |

### 1.5 Hot reload

| Time  | Event                                                                  | Brain                                                                                               |
| ----- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 10:00 | Chat `ses_4` uses `kernel-managed`                                     | —                                                                                                   |
| 10:02 | Asha signs in to Kernel on profile "Main". Ren inserts the credential. | The trigger on `credential` sends `NOTIFY ren_brains`. `BrainPush` tells `brn_7` to pull.           |
| 10:02 | The pull gives a new catalog fingerprint: the credentials changed.     | The plugin removes `kernel-managed` and adds `kernel__main`. The next step sees the official tools. |
| 10:30 | Asha removes the credential                                            | The same path in reverse.                                                                           |

The push exists for `credential`, `app_profile`, `app_profile_space` and `app_profile_link` (`db/migration/20261025101446_brain_push/migration.sql`). The timed pull, every 30 s (`cell/src/env.ts:20`), catches a lost notification.

## 2. Words

| Word                 | Meaning                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Official MCP         | The vendor's MCP, as the registry has it today. It runs on a credential of an app profile.                                    |
| Managed MCP          | An MCP that Ren runs in the integrations service, on Ren's provider accounts. Paid with Ren credits.                          |
| Integrations service | The Bun service in the integrations repository, `service/`, ECS service `mcp`.                                                |
| Resolvable           | An MCP of an app is resolvable in a space when a profile that the space reaches gives a server for it: its credential exists. |
| Selection            | The choice of the MCP servers that a brain gets: `select()` in `core/src/app/selection.ts`.                                   |
| Space key            | The Kernel API key of one Ren space. It works only in that space's Kernel project.                                            |
| Correction row       | A usage row that changes the cost of an earlier estimate row. Its cost can be negative.                                       |

## 3. Decisions

| #   | Decision                                                                                                                                                                                                           | Why                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The registry declares a managed MCP as a second MCP of the app: `transport: { type: managed, server, replaces? }`, `auth: none`. It has no URL. Only a registry app can declare one.                               | One registry release works on every Ren deployment. An organization cannot point Ren's token at its own server.                      |
| 2   | Selection is one pure function, `select()`. `AppResolve` loads its input. It is not an Effect service.                                                                                                             | The strategy can change fast: a later switch is one input field and one rule. There is only one strategy now.                        |
| 3   | The managed MCPs run in the integrations service, under `/managed/` of `mcp.useren.ai`. `REN_INTEGRATIONS_URL` is `https://mcp.useren.ai/managed`.                                                                 | One service and one deploy with billing and the partner MCPs.                                                                        |
| 4   | Ren signs a token of purpose `ren-integrations` for each brain: `org`, `space`, `brain`, `gen`, `exp`, 1 h. The egress injects it as the label `INTEGRATIONS`.                                                     | The receiver checks it offline and keeps no state. It works nowhere else.                                                            |
| 5   | The brain sends `ren-root-session` and `ren-member` (a `PERSON` placeholder) on each managed MCP connection. OpenCode sends the session in `_meta`. `turn` and `agent` stay empty.                                 | The same claims as model calls, where an MCP call can carry them.                                                                    |
| 6   | When the official credential needs a new sign-in, the official server stays.                                                                                                                                       | Ren does not change to Ren credits without a person's choice.                                                                        |
| 7   | The token does not list the managed MCPs of the space.                                                                                                                                                             | The cost stays on the brain's own organization. A list would need a new token on each catalog change.                                |
| 8   | An organization cannot turn managed MCPs off.                                                                                                                                                                      | Managed MCPs make apps work with no setup. Decision 2 keeps a later switch cheap.                                                    |
| 9   | The credit check reads `billing.gate_allowed` through the service's own database connection. When billing is off, every paid call refuses.                                                                         | Billing's tables are in the same database (`service/src/billing/billing.sql.ts`). No paid call is free by mistake.                   |
| 10  | A refusal is an MCP tool error (`isError: true`) with plain text and no internal values.                                                                                                                           | The agent reads it and tells the person what to do.                                                                                  |
| 11  | The service sends usage with `INTEGRATIONS_INGEST_KEY`. Ren accepts that key only for rows with `source: ren-integrations`.                                                                                        | A leaked key can write only this source's rows.                                                                                      |
| 12  | `Usage.ApiCallEvent` accepts a negative cost and `data.corrects` now. No provider sends a correction yet.                                                                                                          | Estimate and correction rows are ready for the first provider that holds a price.                                                    |
| 13  | Kernel: the managed MCP forwards to Kernel's own MCP server (`mcp.onkernel.com`, source `github.com/kernel/kernel-mcp-server`, MIT) with `forwardMcp`.                                                             | All Kernel tools, profiles included, with no tool code. Kernel keeps the tools current.                                              |
| 14  | Kernel: one Kernel project for each Ren space, with one space key bound to that project. The key has no policy: Kernel's MCP server refuses a key with a policy (§6.6). The service allows only the tools of §6.3. | A profile holds signed-in cookies: it stays in its space, private spaces included. Kernel pins every call of the key to the project. |
| 15  | Kernel: usage comes from each project, not from the calls. Each browser carries the tags of the call that created it.                                                                                              | Every browser of the project is counted, on any path. The tags give session and member.                                              |
| 16  | The work lands as two PRs: PR 1 is the scaffolding and end-to-end wiring (one PR in ren, one in integrations), PR 2 is Kernel (integrations). §5, §6.                                                              | Each PR can be reviewed alone.                                                                                                       |

## 4. Branches

| Repo         | Stack today                                       | This work                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ren          | `main` ← `billing` (#122)                         | PR 1 (ren), on `billing`                                                                                                                                                                                                                 |
| integrations | `main` ← `service-layout` (#13) ← `billing` (#12) | PR 1 (integrations), on `billing`. PR 2, on PR 1 (integrations).                                                                                                                                                                         |
| integrations | —                                                 | Follow-up, from `main` after PR 1 (ren) merges: `kernel-managed` in `apps/kernel/mcps.yaml`. The registry checks `apps/` against Ren's `main` schema (`AGENTS.md`). Check it locally first with `REN_REPO=<ren branch> bun run compile`. |
| inference    | `billing-gate` (#12)                              | Not touched                                                                                                                                                                                                                              |

## 5. PR 1: scaffolding and end-to-end wiring

### 5.1 ren

**Schema**

1. `schema/src/mcp.ts`: `Mcp.Transport` gets `{ type: "managed", server: Primitive.Slug, replaces?: Primitive.Slug }`, in `Transport` and in `Info`. `Declaration` checks: a managed MCP has `auth: none`.
2. `schema/src/app.ts`: `Definition` checks: `replaces` names an MCP of the same app whose auth is not `none`. The schema checks run at registry sync and at the API.
3. `schema/src/app-catalog.ts`: `Unavailable.reason` gets `managed`. The description of `McpEntry.url` covers a managed MCP.
4. `schema/src/usage.ts`: `Usage.ApiCall` (`data`: `mcp`, optional `tool`, `upstream`, `units` as a record, `latency_ms`, `corrects`), and `Usage.ApiCallEvent`: the shared fields, with `cost_micro_usd` an integer that can be negative (the shared field is 0 or more, `usage.ts:25`, `:74`). `Usage.Event` and `Usage.Batch` (`usage.ts:103`) accept it. Run `bun run generate` (`protocol/usage-ingest.openapi.json`).

**Core**

1. `core/src/app.ts`: `App.create` and `App.update` (`:67`, `:120`) refuse a `managed` transport with `Primitive.Invalid`. Registry sync writes through `core/src/app/registry.ts`, so registry apps can declare one.
2. `core/src/app/selection.ts`, new:

   ```ts
   export const select = (input: {
     resolved: ReadonlyArray<AppCatalog.McpEntry>   // official servers that the space can use now
     managed: ReadonlyArray<Candidate>              // managed MCPs of the apps that the space reaches
     integrationsUrl: Option.Option<string>
     egress: boolean
   }): { mcps: ReadonlyArray<AppCatalog.McpEntry>; unavailable: ReadonlyArray<AppCatalog.Unavailable> }
   ```

   | Rule | Condition                                                     | Result                                                                                                     |
   | ---- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
   | 1    | An entry of `resolved` has the candidate's app and `replaces` | Leave out the candidate.                                                                                   |
   | 2    | Else, `integrationsUrl` is none                               | Leave it out. `unavailable`, reason `managed`.                                                             |
   | 3    | Else, `egress` is false (a cell host)                         | Leave it out. `unavailable`, reason `egress`.                                                              |
   | 4    | Else                                                          | Add it: server = MCP slug, `profile` null, `label` `INTEGRATIONS`, `url` `<integrationsUrl>/<server>/mcp`. |

   A candidate without `replaces` passes rule 1 always: it is on whenever a profile of its app reaches the space.

3. `core/src/app/resolve.ts`: `build` (`:103-243`) stops putting managed MCPs in `open` (`:139-155`), collects them as candidates of the apps in `ordered`, and calls `select`. `integrationsUrl` comes from `REN_INTEGRATIONS_URL`. Every value that `select` reads comes from `found`, which the fingerprint hashes (`:86-100`). A later switch keeps that rule, so hot reload needs no new code.
4. `core/src/signer.ts`: purpose `ren-integrations`, keys `REN_INTEGRATIONS_KEYS`, next to `ren-billing` (`:6`, `:26`).
5. `core/src/credential-source.ts`, minted candidates and values:
   - Label `INTEGRATIONS` for a brain with a space, host = host of `REN_INTEGRATIONS_URL`, `inject: { op: "replace", in: ["header"] }`, `revision: 0`. Only with `REN_INTEGRATIONS_URL`.
   - The value: `signer.sign("ren-integrations", { org, space, brain, gen, exp: now + 1 h })`, in a `Cache` like `hostTokens` (`:181-203`), renewed 20 minutes before expiry (`:142`), dropped after a 401 (`forget`, `:452`).
   - The `PERSON` candidate (`:316-327`) also covers the integrations host.

**Cell**

1. `cell/src/harness/opencode/mcp.ts`: a managed entry is a remote config with `entry.url` (`:77` already takes `entry.url` for a transport that is not `remote`) and the headers `Authorization: Bearer ren:INTEGRATIONS`, `ren-root-session: <chat ID>`, `ren-member: ren:PERSON.<sender>`. These headers are for each chat and change with the sender, so managed entries join the path of Ren's MCP (`renServers`, `:184-215`; reload on a new sender, `:322`).
2. The namespace description of a managed entry says "paid with Ren credits" (`:106`).

**Server**

1. `server/src/handlers/usage.ts`: `UsageAuthentication` (`:10-21`) also accepts `INTEGRATIONS_INGEST_KEY`. A batch with that key and an event whose `source` is not `ren-integrations` gets 401.

**Specs**

1. `specs/usage.md` §4.5 and §4.6: the `ren-integrations` ID (`kernel:<session_id>`, or `<provider>:<provider's call ID>`) and the type `api.call`.

### 5.2 integrations

1. `service/src/ren-token.ts`: `renToken(keys, claims)` takes the claims schema and sets `claims`. Billing passes `{ org, exp }` with `REN_BILLING_PUBLIC_KEYS`. The managed MCPs pass `{ org, space, brain, gen, exp }` with `REN_INTEGRATIONS_PUBLIC_KEYS`.
2. `service/src/managed/index.ts`, new: the route `/managed/:server/mcp`, mounted in `main.ts` as billing is (`app.route("/managed", managed.routes)`). For each request:

   | Step | What it does                                                                                                                                          | On failure                                                                                                                                                                                                                                      |
   | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 1    | `renToken` with the managed claims.                                                                                                                   | `401`. OpenCode marks the server down and connects again.                                                                                                                                                                                       |
   | 2    | Builds the call context: token claims, `ren-root-session`, `ren-member`, and for `tools/call` the session in `params._meta["ai.opencode/sessionID"]`. | A missing claim stays empty.                                                                                                                                                                                                                    |
   | 3    | For `tools/call` whose `arguments.action` is not `"delete"`: the credit check (item 3).                                                               | A tool error. No row, `insufficient_credits` or `blocked`: "Out of Ren credits. Add credits, or connect your own <app> account." `stale`, a read error, an old unsent row, or billing off: "Paid tools are not available now. Try again later." |
   | 4    | Calls the managed MCP of `:server` with the request and the context.                                                                                  | `404` for an unknown server.                                                                                                                                                                                                                    |

   A managed MCP is `(request: Request, context: CallContext) => Promise<Response>`, as `HostedApp.mcp` (`service/src/mcp/hosted.ts`). The list of managed MCPs is one array in `managed/index.ts`.

3. The credit check: `SELECT reason FROM billing.gate_allowed WHERE org = $1` through the service's `db` (Drizzle view `gateAllowed`, `service/src/billing/billing.sql.ts`). With no billing (`REN_DATABASE_URL` not set), it refuses. It also refuses when the usage client has a row that Ren has not stored for more than 15 minutes (billing R45).
4. `service/src/managed/usage.ts`, new: `sendUsage(rows)` posts `{ events }` to `<REN_URL>/usage/v1/events` with `INTEGRATIONS_INGEST_KEY`. It retries with backoff (`usage.md` §4.7) and keeps the time of its oldest row that Ren has not stored, for item 3.
5. `service/src/config.ts`: `ManagedConfig` with `REN_INTEGRATIONS_PUBLIC_KEYS`, `REN_URL`, `INTEGRATIONS_INGEST_KEY`. Managed MCPs are mounted only when it is set.
6. `infra/aws/service.tf`: the secrets `REN_INTEGRATIONS_PUBLIC_KEYS` and `INTEGRATIONS_INGEST_KEY`, the env `REN_URL`. `/managed/*` reaches the service through the `mcp.useren.ai` host rule.
7. A test-only managed MCP (`service/test/`) with one paid tool proves the path: token, credit check, tool, one `api.call` row at a local ingest route.

### 5.3 Tests

| Test                                                                                                                                                       | Where                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `select`: each rule; two profiles with one connected; a candidate without `replaces`                                                                       | ren `core`           |
| A credential insert, then a delete, changes the fingerprint and swaps the server                                                                           | ren `core`           |
| `App.create` with a managed MCP is refused; a managed MCP with auth that is not `none` fails decoding                                                      | ren `core`, `schema` |
| `INTEGRATIONS` exists only with `REN_INTEGRATIONS_URL`, and its token has the five claims                                                                  | ren `core`           |
| A managed entry gets the token placeholder and the claim headers; a new sender reloads them                                                                | ren `cell`           |
| An `api.call` event with a negative cost is stored; `INTEGRATIONS_INGEST_KEY` with another `source` gets 401                                               | ren `server`         |
| A token of another purpose gets 401                                                                                                                        | integrations         |
| The gate contract cases of billing §4.4, on a real Postgres with the real view. A refusal is a tool error, not an HTTP status. Each refusal calls no tool. | integrations         |
| `action: "delete"` runs at zero credit                                                                                                                     | integrations         |
| No billing: a paid call refuses                                                                                                                            | integrations         |
| The test managed MCP writes one row with the claims of the token, the headers and `_meta`                                                                  | integrations         |

## 6. PR 2: Kernel

All in integrations, on PR 1. Dependency: `@onkernel/sdk`.

### 6.1 Ren's Kernel account

1. One Kernel organization on the Start-Up plan (more than one project).
2. One organization key, `KERNEL_API_KEY`, in the service. It only makes projects and space keys. It never goes upstream with a call.
3. Kernel's default concurrency cap for each project is set, so one space cannot use all of Ren's concurrency.

### 6.2 One project and one key for each space

Table `managed.kernel_space` (Drizzle, pg schema `managed`, a migration): `space` (primary key), `org`, `project_id`, `key` (sealed with `createSealer(MCP_SEALING_KEY, "kernel")`, `service/src/mcp/seal.ts`), `booked_through`.

At the first call of a space, under `pg_advisory_xact_lock(hashtext('kernel:<space>'))`:

1. Find the project `ren-<space>` (`GET /org/projects/<name>`), or create it (`POST /org/projects`). A crash after the create finds it at the next call.
2. Create a key with `project_id` and no policy (`POST /org/api_keys`).
3. Insert the row.

Kernel pins every call of that key to its project. A key with a policy would also make Kernel refuse API keys, projects, browser pools and app invocations, but Kernel's MCP server refuses such a key: `GET /auth/context` answers `403 insufficient_scope`, "not supported for scoped credentials yet" (§6.6 item 4). The tool allowlist of §6.3 refuses those instead. The key never leaves the service.

### 6.3 The managed MCP

`service/src/managed/kernel.ts`: `forwardMcp` (`service/src/partners/forward.ts`) to `https://mcp.onkernel.com/mcp` with `Bearer <space key>`. `forwardMcp` gets two hooks: one that changes or refuses a request before it goes upstream, and one that sees the result.

| Request                                         | What the hooks do                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/list`                                    | Keep only the allowed tools (below).                                                                                                                                                                  |
| `tools/call` of a tool that is not in that list | Refuse with a tool error.                                                                                                                                                                             |
| `manage_browsers`, `action: "create"`           | Before: add `ren_session`, `ren_root_session`, `ren_member`, `ren_brain` to `arguments.tags` (`kernel-mcp-server` `src/lib/mcp/tools/browsers.ts:517`).                                               |
| `manage_browsers`, `action: "update"` with tags | Before: add the same four tags. An update replaces all tags of the browser.                                                                                                                           |
| `manage_profiles`, `action: "setup"`            | After: read `session id: <id>` from the result (`src/lib/mcp/tools/profiles.ts:209`) and set the same tags with `PATCH /browsers/<id>`. That tool creates a browser with no tags (`profiles.ts:194`). |

Allowed tools: `manage_browsers`, `manage_profiles`, `manage_proxies`, `manage_vaults`, `manage_vault_items`, `manage_vault_credentials`, and the tools that drive a browser of the project (`computer_action`, `exec_command`, `execute_playwright_code`, `manage_playwright_executors`, `browser_repl`, `browser_curl`, `manage_browser_files`, `manage_replays`, `webmcp`), plus `search_docs` and `get_connection_context`. Left out: API keys, projects, browser pools, apps, extensions, the config registry, managed auth and credential providers, payment wallets and cards, organization provider configs, feedback and `get_more_tools`.

Tag values come from the call context. Kernel tag values allow `A-Za-z0-9 _.:/=+@-`, so an ID and a `ren:PERSON.<member>` placeholder fit.

### 6.4 Browsers that are left open

Kernel bills active time only: a browser idle for 5 s goes to standby and costs nothing. Kernel deletes a browser after its `timeout_seconds` of no activity (default 60 s, `manage_profiles` setup uses 300 s). The loop books it after that.

### 6.5 The usage loop

Every 60 s, in each service copy, for each row of `managed.kernel_space`, under `pg_try_advisory_xact_lock(hashtext('kernel-usage:<space>'))`:

1. List the deleted browsers of the project (`GET /browsers?status=deleted`, `X-Kernel-Project-Id`), from the newest, until `deleted_at` is not after `booked_through` (order: §6.6 item 1).
2. For each browser with `usage_status: ready`, make one row:

   | Field                                        | Value                                                                                                                                                                   |
   | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `source`, `id`, `type`                       | `ren-integrations`, `kernel:<session_id>`, `api.call`                                                                                                                   |
   | `time`                                       | `deleted_at`                                                                                                                                                            |
   | `organization`, `space`                      | The `managed.kernel_space` row                                                                                                                                          |
   | `brain`, `session`, `root_session`, `member` | The tags. `workload` = `brain:<ren_brain>`                                                                                                                              |
   | `payer`, `provider`                          | `ren`, `kernel`                                                                                                                                                         |
   | `cost_micro_usd`                             | GPU: `round(uptime_ms / 1000 × 800.0016)`. Else: `round(uptime_ms / 1000 × GiB × 16.6667)`, GiB from `memory` (`1GiB` … `16GiB`). Rates: `kernel.sh/docs/info/pricing`. |
   | `data`                                       | `mcp: "kernel-managed"`, `upstream: "browsers"`, `units: { uptime_ms, memory, gpu }`                                                                                    |

3. `sendUsage` the rows. After Ren answers 200, move `booked_through` to the newest `deleted_at` of the booked rows. A browser with `usage_status: pending` stops the move: the next pass reads it again. Ren ignores a row that it has, so a row sent two times is stored one time.
4. A browser with no `ren_session` tag still gives a row with `organization` and `space`. The loop logs an error that names the browser: a new upstream path that makes browsers shows in the logs, not as lost money.

### 6.6 Checks before build, with a Kernel test key

Run on 31 Oct 2026 with Ren's organization key, on a test project.

| #   | Check                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The order of `GET /browsers?status=deleted`             | Newest `deleted_at` first. `usage_status` was `ready` 5 s after the delete. The loop keeps `booked_through`.                                                                                                                                                                                                                                                                                                             |
| 2   | The Kernel MCP tools that the space key can use         | All 31 that `tools/list` gives to a key without a policy. The service allows the subset of §6.3.                                                                                                                                                                                                                                                                                                                         |
| 3   | `PATCH /browsers/<id>` with `tags` on a running browser | 200. The tags are replaced, not merged.                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | `mcp.onkernel.com` accepts the space key                | Only a key without a policy. A key with a policy gets `403 insufficient_scope` ("This credential is not scoped to the requested Kernel project"): the server reads `GET /auth/context`, which Kernel does not serve to such a key yet. A key with only `project_id` gets `credential_scope.project_id` = the project, so the server pins every call to it (`src/lib/mcp/auth-context.ts`, `project-selection.ts:54-69`). |

### 6.7 Tests

| Test                                                                                              | Where        |
| ------------------------------------------------------------------------------------------------- | ------------ |
| Two first calls of one space make one project and one key                                         | integrations |
| `tools/list` shows only the allowed tools; a call to another tool is refused                      | integrations |
| `manage_browsers` create goes upstream with the four tags                                         | integrations |
| `manage_profiles` setup: the new browser gets the four tags by `PATCH`                            | integrations |
| A deleted, ready browser gives one row with the cost and the tags; a second pass sends no new row | integrations |
| A pending browser stops `booked_through`; the next pass books it                                  | integrations |
| An untagged browser gives a row with org and space and an error log                               | integrations |

The upstream MCP and the Kernel API are fakes in these tests, as billing uses a fake Dodo (`service/test/billing/`).

## 7. Edge cases

### 7.1 Product

| Case                                 | What happens                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App added, nobody connected          | Managed MCP. Ren credits pay.                                                                                                                                         |
| Someone connects their own account   | The official MCP replaces the managed one in one pull. The org's account pays from then on.                                                                           |
| The account is removed               | The managed MCP comes back.                                                                                                                                           |
| The credential needs a new sign-in   | The official server stays and shows that it needs a sign-in (decision 6).                                                                                             |
| Out of Ren credits                   | A tool error that names both fixes: add credits, or connect your own account. `action: "delete"` still runs.                                                          |
| An org does not want Ren-paid tools  | It cannot turn them off (decision 8). It can connect its own account, or not add the app.                                                                             |
| The managed and official MCPs differ | Kernel: the same tools, because the managed MCP forwards to Kernel's server. A change mid-turn makes a call to a removed tool fail; the next step sees the new tools. |
| A profile made in a private space    | It is in that space's Kernel project only (decision 14).                                                                                                              |
| A custom app of an organization      | It cannot declare a managed MCP.                                                                                                                                      |
| Self-hosted Ren                      | No managed MCPs (no `REN_INTEGRATIONS_URL`).                                                                                                                          |

### 7.2 Technical

| Case                                                   | What happens                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| A cell host (no egress)                                | Selection rule 3: `unavailable`, reason `egress`.                                                              |
| The integrations service or `mcp.onkernel.com` is down | The server is `failed`. The plugin connects again on its retry delays (`mcp.ts:147`).                          |
| The catalog changes while a managed call runs          | The call ends with a tool error (hot reload case C8). The browser, if made, is still booked by the loop.       |
| A registry release adds a managed MCP                  | The `app` table sends no `NOTIFY`. Brains see it at the next timed pull, 30 s at most.                         |
| The brain calls the service without the MCP            | The egress adds the token by host. The cost stays on its own organization (decision 7).                        |
| `mcp.useren.ai` also serves partner MCPs               | The egress replaces each placeholder by its own text: `ren:INTEGRATIONS` and `ren:MCP_FIGMA__MAIN` do not mix. |
| A retired generation's token                           | It works until `exp`, at most 1 h. Its sandbox is gone.                                                        |
| Ren's ingest route is down                             | The loop does not move `booked_through`; Kernel keeps the data. After 15 minutes, paid calls refuse (R45).     |
| The service restarts                                   | Nothing is lost: the loop reads Kernel again from `booked_through`.                                            |
| Billing is stale                                       | `gate_allowed` gives `stale`. Paid calls refuse. `action: "delete"` runs.                                      |
| An org made before ren #122 deployed                   | No billing customer, so no `gate_allowed` row: paid calls refuse, as LiteLLM calls do, until the backfill.     |
| Kernel concurrency is full                             | Kernel's error reaches the agent as the tool result.                                                           |

## 8. Lifecycle states

| State                       | Token                                             | Catalog                                                | Usage                                                 |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Brain asleep                | Not used                                          | Not applied                                            | Open browsers time out. The loop books them.          |
| Brain wakes, new generation | The egress mints a token for the new generation   | The first pull gives the current selection             | Browsers are in the space's project, not the brain's. |
| Mid-turn                    | Ren renews 20 minutes before expiry               | A change reloads the servers in the background         | —                                                     |
| Ren down                    | The egress keeps its last answer until it expires | The brain keeps its catalog (`core/src/brains.ts:489`) | The loop waits; after 15 minutes paid calls refuse.   |
| Service restarts            | —                                                 | OpenCode connects again                                | The loop continues from `booked_through`.             |

## 9. Later

| Item                                                                               | When                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| treg as a provider; DataForSEO and other treg-backed managed MCPs                  | After Kernel. Facts in [references/providers.md](references/providers.md) §1.         |
| Estimate rows and correction rows from a provider that holds a price               | With that provider. Billing's change: [references/billing.md](references/billing.md). |
| `turn` and `agent` on tool rows: OpenCode adds them to the `_meta` of `tools/call` | An OpenCode change                                                                    |
| A switch for managed MCPs (organization, profile or person)                        | A new input of `select()`                                                             |
| Delete the Kernel project of an archived space                                     | After launch. A project must be empty before Kernel deletes it.                       |
