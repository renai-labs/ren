# Hot reload: spec

Status: spec written. Decisions: HR1 to HR29 ([README §5](README.md#5-decisions)). Tests: [references/tests.md](references/tests.md).

This document uses ASD-STE100 (Simplified Technical English) style.

## 1. Goal

A change in Ren reaches each running brain without a restart:

- in about 1 s when the user must see it at once (push);
- in 30 s or less when a delay is acceptable (pull).

The design is the same for every host (cell, Docker, E2B) and every harness (OpenCode today). A host or a harness is a layer behind a service.

## 2. Model

```
┌──────────────────┐   COMMIT                 ┌──────────────────┐   NOTIFY ren_brains        ┌──────────────────┐   BrainHost.notify(id)    ┌──────────────────┐
│                  │  ────────────────▶       │                  │   'space:<id>' |           │                  │   2 s timeout,            │                  │
│  write in core   │                          │  Postgres        │   'org:<id>' | 'all'       │  BrainPush       │   parallel limit          │  brain           │
│  (any table of   │                          │  trigger         │  ─────────────────▶        │  (each server    │  ─────────────────▶       │  POST /ren/pull  │
│  HR10)           │                          │                  │                            │  instance)       │                           │  202 at once     │
│                  │                          │                  │                            │                  │                           │                  │
└──────────────────┘                          └──────────────────┘                            └──────────────────┘                           └──────────────────┘

┌──────────────────┐   POST /host/pull                    ┌──────────────────┐   full state               ┌──────────────────┐   configure(update)       ┌──────────────────┐
│                  │   { version, keyIds, sessions,       │                  │   (no hashes)              │                  │   only what changed       │                  │
│  HotReload.pull  │     roots }                          │  Brains.pull     │  ─────────────────▶        │  HotReload       │  ─────────────────▶       │  harness         │
│  timer 30 s,     │  ─────────────────────▶              │                  │                            │  compares,       │                           │  applies at its  │
│  push, prompt,   │                                      │                  │                            │  stores          │                           │  safe point      │
│  start, send,    │                                      │                  │                            │                  │                           │                  │
│  wake            │                                      │                  │                            │                  │                           │                  │
└──────────────────┘                                      └──────────────────┘                            └──────────────────┘                           └──────────────────┘

┌──────────────────┐   GET /model/info every 30 s, and on refreshModels                                   ┌──────────────────┐
│                  │  ◀──────────────────────────────────────────────────────────────────────────────    │                  │
│  LiteLLM         │   Authorization: ren:MODELS (the egress adds the key) or the cell's key              │  harness adapter │
│                  │                                                                                      │  Models.fromLiteLLM
└──────────────────┘                                                                                      └──────────────────┘
```

## 3. Paths

| Part                                                                    | Source                                                            | Reaches the brain                                                 | The harness applies it                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Settings: agents, instructions, permissions, references, a chat's agent | `settings`, `agent`, `agent_membership`, `agent_session.agent_id` | Push, and pull every 30 s                                         | Next step (HR21). A permission: next check                                                |
| Credential env vars                                                     | `credential`, `app_profile*`, `space_member`                      | Push, and pull                                                    | Next process start. A removal at once (HR18)                                              |
| App catalog: MCP servers, skills                                        | Pull only                                                         | Pull every 30 s                                                   | MCP: at once; a running call on a changed or removed server ends (HR1). Skills: next step |
| Archive, delete of a chat                                               | `agent_session` (`archived_at`, `DELETE`)                         | Push, and pull                                                    | At once: interrupt the turn, then drop a deleted chat (HR22, HR23)                        |
| Models                                                                  | LiteLLM `/model/info`                                             | The harness reads it every 30 s, on wake, and on an unknown model | Next step                                                                                 |
| LiteLLM base URL                                                        | Pull reply `inference.baseUrl`                                    | Pull                                                              | Next request                                                                              |
| Public keys, host token                                                 | Pull reply; `ren-host-token` header                               | Pull; each Ren call                                               | At once                                                                                   |

## 4. Rules

1. A push carries no data. The pull is the one data path (HR8).
2. Ren sends the full state on each pull. The brain compares the content. When the content is the same, the brain writes nothing to storage and reloads nothing (HR9).
3. A push during a running pull marks one more pull. More pushes add nothing (HR13).
4. A push never resumes a paused sandbox and never extends a keep-alive (HR12).
5. The pull lock is never held while the brain waits for an MCP server, a turn or a model call (HR19).
6. Ren waits for MCP servers only at boot, before the first turn (HR19).
7. The trigger on `agent_session` fires only for `archived_at`, `agent_id` and `DELETE`. Sync never sends a push (HR23).
8. A row with a space pushes to that space; a row with an org pushes to that org; a row with neither pushes to every brain (HR11, HR25).
9. The same state gives the same system prompt bytes (ren-v1 INV-34).

## 5. Contracts

### 5.1 Shared

| Package                  | Change                                                                                                                                  | Decision       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `host-api` `BrainApi`    | Add `POST /ren/pull`: server token, no body, `202`. It uses the same handler wrapper as the other Ren calls (`cell/src/brain.ts:65-71`) | HR13, HR17     |
| `host-api` `PullRequest` | Ren ignores `models`, `apps`, `layers` (known hashes) and `env`. Remove them after old brains are replaced                              | HR9            |
| `host-api` `PullReply`   | Always send `apps.catalog`, `layers`, `env.variables`, `chats`, `deleted`, `publicKeys`. Replace `models` with `inference: { baseUrl }` | HR3, HR9, HR16 |
| `schema` `Models`        | Add `Models.fromLiteLLM(modelInfo): Models.Catalog`                                                                                     | HR15           |
| `db` migration           | Add `ren_notify_brains()` and its triggers (HR10, HR23, HR25)                                                                           | HR10           |

After the `host-api` change, run `bun run generate`.

### 5.2 Core

| Service           | Change                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrainHost`       | Add `notify(brainId): Effect<void>`. `layerCell` calls the cell. `layerSandbox` calls the URL in the brain row. It never calls `access`, `ensure` or `touch` (HR12)                            |
| `BrainPush` (new) | Listens on `ren_brains`. For each scope, reads the brain ids and calls `BrainHost.notify` with a 2 s timeout and a parallel limit. Ignores each failure. Listens again after a lost connection |
| `Brains.pull`     | No hash compare. Full bodies. No model grant (HR3, HR9)                                                                                                                                        |
| `Models`          | Add `layerLiteLLM`: reads `/model/info`, maps with `Models.fromLiteLLM`, serves the picker and the model checks. `layerConfig` stays for local runs (HR28)                                     |
| `models.refresh`  | Unchanged. It gives a cell its real LiteLLM key (HR29)                                                                                                                                         |

### 5.3 Brain

| Part                        | Change                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HotReload`                 | Serves the push with "one more pull". No hashes. Compares content before `apps.save`, `settings.save` and `credentialEnv.apply`                                                              |
| `Harness.Instance`          | Add `refreshModels: Effect<void>`. `configure` can be called at any time, also mid-turn (HR1, HR24)                                                                                          |
| `brain.wake`                | Also calls `refreshModels` (HR26)                                                                                                                                                            |
| `start`, `setModel`         | On an unknown model: `refreshModels`, then check again (HR14)                                                                                                                                |
| `Cell.alarm`                | Starts `hotReload.pull` in its own fiber while the harness is open (HR17)                                                                                                                    |
| `CredentialEnv`             | Remove `wanted`, `applied` and `turnEnded` (HR18)                                                                                                                                            |
| `OpenCodeExecution`         | Remove the wait for idle: `offer`, `idle` and the gate (HR1)                                                                                                                                 |
| `OpenCodeMcp`               | Keep only the wait at boot. Retries run at any time. Put the profile in the description of each server's tool namespace. Remove the "unavailable" and "no environment" notes (HR19, HR20)    |
| OpenCode model plugin (new) | Reads `/model/info` every 30 s, maps with `Models.fromLiteLLM`, reloads providers on a change, keeps and stores the last list (HR14, HR24). Replaces the pull path of `ModelProviders.apply` |
| Deleted chats               | A busy chat that Ren names deleted is interrupted, then dropped (HR22)                                                                                                                       |

## 6. Lifecycle states

| State               | Result                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| asleep: E2B paused  | A push fails and is ignored (HR12). The wake pulls and calls `refreshModels` before it answers (`cell/src/brain.ts:139-148`, HR26)               |
| asleep: cell closed | A push opens the cell. It pulls, then closes when idle                                                                                           |
| waking              | A push in the gap before the wake pull is covered by the wake pull. A wake pull that fails is repaired by the pull of the next `start` or `send` |
| mid-turn            | Each change applies at the harness's safe point (§3). An MCP server change ends a running call on that server                                    |
| down                | A push times out in 2 s and does not delay other brains. The boot pulls                                                                          |
| restarting          | The boot uses the stored catalog, settings, env vars and model list. It pulls every 1 s until the first pull works (`cell/src/bun.ts:142`)       |
| Ren down            | Pulls fail; the brain keeps its last state (`cell/src/hot-reload.ts:125`). Writes stop, so no change is lost                                     |
| Ren restarting      | `NOTIFY` signals during the gap are lost. The 30 s pull covers them                                                                              |
| LiteLLM down        | The harness keeps its last model list                                                                                                            |
| retired generation  | A pull does nothing (`cell/src/hot-reload.ts:59`). `notify` reaches only the current generation                                                  |

## 7. Seams

| Swap                                     | What changes                                                                                                                                                                                                                          | What stays                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| E2B ↔ Cloudflare Durable Object ↔ Docker | `BrainHost.notify` per layer; the timer (Bun scheduler or Durable Object alarm)                                                                                                                                                       | Push, pull, `HotReload`, `CredentialEnv`, the rules of §4       |
| OpenCode ↔ Pi                            | The harness adapter: how `configure` applies a change, the safe point, the model read and its mapping (for example, the base URL suffix: OpenCode needs `/v1`, Pi does not, `ren-v1/packages/inference/src/harness/harness/pi.ts:38`) | `Harness.Instance`, `Models.fromLiteLLM`, the pull and the push |
| LiteLLM ↔ another inference module       | `Models.fromLiteLLM` and the read URL                                                                                                                                                                                                 | `Models.Catalog`, the harness adapters                          |
| Postgres `NOTIFY` ↔ another change feed  | `BrainPush`'s source                                                                                                                                                                                                                  | The scope format and `BrainHost.notify`                         |

## 8. Removed

- `OpenCodeExecution`'s wait for idle (`cell/src/harness/opencode/execution.ts`).
- `ready` after a reload, and `boundary.idle` around retries (`cell/src/harness/opencode/mcp.ts:171-226`).
- The hash fields of the pull and `BrainSettings.known`, `merge` and `kept` (`brain/src/settings.ts:61-82`).
- Models in the pull: `Models.grant` in `Brains.pull`, `ModelStore.install` from the pull.
- `CredentialEnv.turnEnded` and its call in `cell/src/bun.ts:130`.
- The notes for unavailable servers and missing environments (`cell/src/harness/opencode/mcp.ts:118-126`, `:229-241`).

## 9. Verification

The implementation is done only when every run below passes (HR27). The pull request lists each command, its seeds and its result. A failed run blocks the merge. A run that passes only on a retry is a bug, not a flake.

| #   | Run              | Command (from the package)                                                         | Needs                                               | Shows                                                                                                                                                                                           |
| --- | ---------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Package tests    | `bun run test` in `schema`, `db`, `core`, `cell`, `server`, with `REN_SLOW=1`      | Docker (Postgres)                                   | Tests 1 to 45 of [references/tests.md](references/tests.md)                                                                                                                                     |
| V2  | Local chaos lane | `bun run chaos` in `e2e`                                                           | Wrangler, Docker                                    | The real chain: write → trigger → `NOTIFY` → `BrainPush` → cell `/ren/pull` → pull → OpenCode, on the `cell` and `cell-docker` profiles. New case file: `chaos/cases/hot-reload.test.ts` (§9.1) |
| V3  | Seeded sequences | `CHAOS_SEQUENCES=10 CHAOS_ACTIONS=20 bun run chaos chaos/cases/hot-reload.test.ts` | as V2                                               | Invariants I1 to I8 after each seeded sequence ([references/tests.md §4](references/tests.md#4-seeded-sequences))                                                                               |
| V4  | Deployed lane    | `bun run chaos:deployed` in `e2e`                                                  | E2B and Cloudflare credentials                      | Pause, push, resume and wake on a real E2B sandbox; the cell on Cloudflare                                                                                                                      |
| V5  | Live models      | `bun run chaos:live` in `e2e`                                                      | `CHAOS_LIVE_MODEL`, a LiteLLM with two virtual keys | `/model/info` per key; a model added and removed in LiteLLM reaches a running brain                                                                                                             |
| V6  | User journeys    | `bun run test` in `e2e`                                                            | `docker compose up -d`                              | U1 to U3                                                                                                                                                                                        |

### 9.1 Chaos cases

Each case runs on the real stack of `chaos/lib/stack.ts`. Each case uses the fault proxy on the links it names.

| Case | Path                        | Lifecycle states                                               | Must hold                                                                                                                                                       |
| ---- | --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | Settings push               | open idle, mid-turn (tool call running), closed cell           | The change reaches the next step in 2 s. A closed cell opens, pulls and closes (I1, I4)                                                                         |
| C2   | Env var push                | mid-turn with a running process                                | The running process keeps the old env; the next process has the new env in 2 s (HR18)                                                                           |
| C3   | Catalog pull                | mid-turn, a long turn; the lane sets `PULL_INTERVAL_MS` to 2 s | An added server's tools appear in one pull interval, without a push (HR4, HR17)                                                                                 |
| C4   | Push lost                   | the Ren-to-brain link drops each push                          | The change arrives by the next timer pull (HR8)                                                                                                                 |
| C5   | Push storm                  | 200 writes in 1 s to one space                                 | Each brain does 2 pulls or fewer per running pull (I3)                                                                                                          |
| C6   | `LISTEN` lost               | the server's database connection is cut, then restored         | The listener listens again; brains converge in one pull interval (I1)                                                                                           |
| C7   | Archive and delete          | busy chat                                                      | The turn stops in 2 s; the model provider gets no more requests for it (HR22, HR23)                                                                             |
| C8   | MCP server change mid-call  | a call held by `McpPeer`                                       | The call ends with a tool error; the turn continues; the next step uses the new server (HR1)                                                                    |
| C9   | MCP reconnect               | upstream answers 401, then 200 after a credential change       | The next prompt connects the server; other servers are not restarted (HR19)                                                                                     |
| C10  | Brain crash during a change | the brain process is killed between the push and the pull      | The boot pulls and applies the change; the turn resumes (I7)                                                                                                    |
| C11  | Ren down                    | the brain-to-Ren link refuses, then returns                    | The brain keeps its state; it converges after Ren returns (I1)                                                                                                  |
| C12  | E2B pause (V4)              | paused sandbox                                                 | A push does not resume it and does not change `keep_alive_until`. The wake applies every change made during the pause and reads models again (I6, HR26)         |
| C13  | LiteLLM model change (V5)   | mid-turn                                                       | An added model is in the brain's list in one read interval; a removed model fails the next request with a classified error, and the next turn falls back (HR14) |
| C14  | Key filter (V5)             | two keys with different model lists                            | Each brain lists only its key's models (HR15)                                                                                                                   |
