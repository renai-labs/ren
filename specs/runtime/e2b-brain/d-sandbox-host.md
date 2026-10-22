# Piece D: sandbox brain host

Status: spec written. Decisions: E16, E32–E37, E39, E40, E65–E89, E93, E95 (README §6). E65–E67 came from a parallel session; the rest from this one.

## Goal

Ren runs each brain in a sandbox, wakes it on demand, keeps it awake while its chats make progress, replaces it when it is gone or does not wake, and cleans it up when every chat is archived. The provider (local process, E2B, later Daytona) and the durable engine (Effect cluster now, Temporal later) are each a swappable layer.

Not in this piece: restore of sessions into a new sandbox (piece E), the E2B template (piece G).

## Layers

```
 core (no provider or engine types)
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │ BrainHost.layerSandbox ── Session.access / create / send ──▶ DurableRunner.ensure(key) │
 │ BrainLifecycle.step(brainId): one action per call, state on the brain row (E71)         │
 └──────────────┬───────────────────────────────────────────────┬───────────────────────┘
                │ SandboxProvider                               │ DurableRunner
   ┌────────────▼──────────────┐                    ┌───────────▼────────────────────────┐
   │ layerLocal (E65, E67)     │                    │ layerEffect: effect/workflow on the │
   │ layerE2B   (E80)          │                    │ cluster, runners in Postgres (E75)  │
   │ later: Daytona            │                    │ later: layerTemporal                │
   └───────────────────────────┘                    └─────────────────────────────────────┘
 BrainHost.layer (workerd, CELL_URL) stays as the second host (E40): always ready, no runs.
```

## Services

### `SandboxProvider` (E66)

```ts
export interface Interface {
  readonly create: (input: {
    readonly brainId: Brain.ID
    readonly generation: number
    readonly env: Readonly<Record<string, string>>
  }) => Effect.Effect<Schema.Json, Failed> // binding; safe to repeat per brain and generation
  readonly connect: (binding: Schema.Json) => Effect.Effect<{ readonly url: URL }, Gone | Failed> // resumes if paused
  readonly keepAlive: (binding: Schema.Json, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly destroy: (binding: Schema.Json) => Effect.Effect<void, Failed> // gone counts as done
}
```

| Layer        | `create`                                                                                                       | `connect`                                           | `keepAlive`                                   | `destroy`               |
| ------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------- | ----------------------- |
| `layerLocal` | starts one Bun brain process group per brain id on Ren's machine (E65)                                         | `SIGCONT` to the process group; `Gone` if it exited | a timer in Ren; when it ends, `SIGSTOP` (E67) | kills the group         |
| `layerE2B`   | `POST /sandboxes`: template `ren-brain-dev`, `onTimeout: "pause"`, `autoResume: false`, metadata, `envs` (E80) | `POST /sandboxes/:id/connect`; not found is `Gone`  | `POST /sandboxes/:id/timeout` (exact)         | `DELETE /sandboxes/:id` |

Safe to repeat: before it creates, `layerE2B` lists sandboxes with metadata `{ brain, generation }` and reuses one it finds. That matches `EnvironmentProvider.provision` (`core/AGENTS.md`).

Environment given to a new brain: `REN_URL`, `REN_BRAIN_ID`, `REN_BRAIN_GENERATION`, `BRAIN_PUBLIC_KEYS` (piece C). No secret: the first host token arrives in Ren's first call (E69).

### `DurableRunner` (E71, E75)

A run is an Effect workflow: a name, a payload schema and a key (`DurableRunner.make`). The owner registers its handler at layer build (`DurableRunner.register`); `DurableRunner.ensure(run, payload)` starts the run or joins the running execution with that key. `layerEffect` is `ClusterWorkflowEngine` on `SingleRunner` with Postgres storage: a run continues after a Ren restart, and one execution per key runs across all replicas. `layerMemory` is for tests.

A key that finished does not run again; the engine returns the stored result. ren-v1's Temporal (`USE_EXISTING`) started a new run after the previous one closed. To get that behaviour, a run that must run again has a counter in its key (user decision, item 3):

- `brain:<brainId>:<run_epoch>`. The run adds 1 to `brain.run_epoch` when it ends, not when it is interrupted.
- `start:<sessionId>:<first message id>`. A restart of a lost chat has a new first message.

### Runs

| Key                 | Input                          | Does                                                                                                    | Decision |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- | -------- |
| `brain:<brainId>`   | none                           | steps until `ready` or `failed`                                                                         | E71      |
| `start:<sessionId>` | start input with first message | ensures `brain:<brainId>`, waits for `ready`, then `brain.start`                                        | E68      |
| `send:<messageId>`  | send input                     | ensures `brain:<brainId>`, waits for `ready`, then `brain.send`. Built when Ren first sends on its own. | E77      |
| `cleanup:<date>`    | none                           | destroys sandboxes of brains whose chats are all archived; retries failed destroys                      | E76      |

### `BrainLifecycle.step`

State lives on the `brain` row: `phase`, `generation`, `run_epoch`, `provider`, `binding`, `key_ids` (piece C), `keep_alive_until`, `last_progress_at`.

| Phase        | One action                                                                                                                                             | Next                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| (no binding) | —                                                                                                                                                      | `creating`                                         |
| `creating`   | `provider.create`, store the binding                                                                                                                   | `booting`                                          |
| `booting`    | poll `GET /ren/state` with a server token until it answers, at most 120 s (E69)                                                                        | `ready`; on timeout, destroy and `failed`          |
| `resuming`   | `provider.connect`, then `keepAlive` (idle window)                                                                                                     | `waking`; `Gone` → `replacing`                     |
| `waking`     | `POST /ren/wake`, at most 60 s (E73)                                                                                                                   | `ready`; on timeout → `replacing` (E35)            |
| `replacing`  | one transaction: `generation + 1`, busy chats of the brain → idle with outcome `interrupted` (E39); then `provider.destroy(old)`, which may fail (E74) | `creating`                                         |
| `ready`      | —                                                                                                                                                      | done                                               |
| `failed`     | —                                                                                                                                                      | done; the next `ensure` starts again at `creating` |

`ensure("brain:…")` on a `ready` brain first checks reachability: `connect` (cheap when running), and `waking` when it was paused.

## Behaviour

### Access, create, send (E36, E66, E68, E70)

- `Session.access` reads `brain.phase` and `keep_alive_until`. It returns `ready { url, token }` only when `phase = ready` and `keep_alive_until` is more than 2 min away. With 2 min or less left, it calls `keepAlive` first, then returns `ready`. When `keep_alive_until` has passed (the sandbox is paused) or `phase` is not `ready`, it calls `ensure("brain:…")` and returns `starting { phase }`. Every access counts as activity for the idle window (E72). The app asks again every 2 s.
- `Session.create` writes the session and calls `ensure("start:<sessionId>", …)`, then returns.
- The workerd host always returns `ready`.

### Keep-alive (E72)

- `/host/pull` (piece B) also sends, per chat: `busy` and `progress`, an opaque counter from `Harness.Instance.sessions`.
- Ren stores `last_progress_at` when any busy chat's counter changed since the last pull.
- Window: 30 min while a chat is busy and `last_progress_at` is under 30 min old; otherwise 10 min after the later of the last active pull and Ren's last access, start or send to the brain.
- Ren calls `keepAlive` only when less than half the window is left on `keep_alive_until`.

### E2B specifics (E78, E79, E80)

- A paused sandbox is kept and not billed. Nothing destroys it except cleanup (E76).
- E2B's continuous-running limit (24 h Pro, 1 h Hobby) is not managed: a pause or reboot at the limit goes through wake or boot; a kill is `Gone`.
- Ports are public. The brain's port checks tokens; other ports are open (known risk).
- Dev rules (README §7): template `ren-brain-dev`, metadata `{ owner: "ren-v2-dev" }`, list and kill only sandboxes with that metadata, and ask the user before the first sandbox create.

### Failures, archive, cleanup, capacity

- A provider `Failed` (a transient error) never leads to a replace: the step fails and the run retries with backoff. Only `Gone` or a wake that is not confirmed in 60 s lead to `replacing` (ren-v1 test "tryResume rethrows transient provider errors").
- Failure budget: 3 create, boot or wake failures in a row per outage, then `phase = failed`; `Session.access` returns `failed { reason }`. Retry in the app resets the count, and so does `ready` (E81).
- Capacity (E2B 429, or no capacity) is not a failure: `starting { phase: "waiting for capacity" }`, retry after `Retry-After`. Development caps running sandboxes at `SANDBOX_MAX_RUNNING` (default 10) (E88).
- `SandboxProvider` gains `status(binding)` (`running`, `paused`, `gone`) and a `lost` stream of `{ brainId, generation }` (E82). `layerLocal` checks its processes every 2 s; `layerE2B` gives an empty stream until E2B lifecycle webhooks are registered. On a lost sandbox, and when a call to the brain fails as unavailable and `status` says `gone`, the brain becomes `replacing` and its busy chats `interrupted` at once; the next access replaces it.
- A `start:<sessionId>` run gives up when its brain reaches `failed`, or when the creator can no longer see the space. The app keeps the first and queued messages in local storage and re-sends them on Retry (E84, E95).
- Archiving a chat interrupts its turn through the pull reply (E85).
- Daily cleanup destroys the sandbox of a brain whose chats are all archived or whose space is archived (E76, E87); lists provider sandboxes by metadata and destroys those without a `brain` row (E86); calls `status` for brains with busy chats (E82); retries failed destroys.
- `Session.prepare(spaceId)` runs `ensure("brain:…")` for an existing space brain, at most once per 5 min per space (E93).
- A template change (system packages or an OpenCode binary that cannot update in place) leads to a replace at an idle moment. Other brain updates happen in place (E89).

## Contract changes

| Package       | Change                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`          | `brain`: `provider text`, `binding jsonb`, `generation integer not null default 1`, `phase text not null`, `keep_alive_until timestamp`, `last_progress_at timestamp`. Effect cluster tables (from `SqlMessageStorage`, `SqlRunnerStorage`). |
| `protocol`    | `Session.ClientAccess` becomes a union: `ready { url, token, expiresAt }` or `starting { phase }`. Run `bun run generate`.                                                                                                                   |
| `core`        | `SandboxProvider` with `layerLocal` and `layerE2B`; `DurableRunner` with `layerEffect`; `BrainLifecycle`; `BrainHost.layerSandbox`. `Session.create` no longer calls `BrainHost.start` in the request.                                       |
| `host-api`    | `/host/pull` request gains `sessions: [{ id, busy, progress }]` (E72).                                                                                                                                                                       |
| `cell`        | `Harness.Instance.sessions` gains `progress` (from OpenCode's event counter).                                                                                                                                                                |
| `chat`, `app` | handle `starting { phase }`: show the phase and ask again every 2 s.                                                                                                                                                                         |
| `server`      | `main.ts` picks `SandboxProvider.layerE2B` or `layerLocal` and `DurableRunner.layerEffect`.                                                                                                                                                  |

## Lifecycle states

| State                              | What happens                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| asleep (paused)                    | `phase` stays `ready`, but `keep_alive_until` has passed, so `Session.access` calls `ensure`: connect, then wake. Without this check, access would return a paused sandbox's URL forever. |
| waking                             | `resuming`, then `waking`. A wake over 60 s → `replacing` (E35, E73).                                                                                                                     |
| mid-turn                           | Keep-alive extends while the turn makes progress (E72). A run never blocks a turn.                                                                                                        |
| down (provider API)                | Steps fail and retry with backoff. `Session.access` returns `starting { phase }`.                                                                                                         |
| down (Ren)                         | Runs resume after Ren restarts (E71). Sandboxes pause when keep-alive runs out.                                                                                                           |
| restarting (brain process)         | Restart loop in the sandbox (E7); Ren does not notice.                                                                                                                                    |
| gone (E2B kill, admin, 24 h limit) | `connect` → `Gone` → `replacing` → `creating`. Busy chats become `interrupted` (E39). Restore is piece E.                                                                                 |
| replaced while alive               | The old sandbox gets 403 `GenerationRetired` and fences itself (E51). Destroy is retried by cleanup.                                                                                      |

## Tests

Write each test first. Each test must fail before its change. Core tests use `layerLocal` with real Bun brain processes (E65), no mocks.

| #   | Package and file                    | Test                                                                                                                                                                                |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `core/test/brain-lifecycle.test.ts` | A brain with no sandbox goes `creating` → `booting` → `ready`; `Session.access` returns `starting` before and `ready` after.                                                        |
| 2   | `core/test/brain-lifecycle.test.ts` | A paused (SIGSTOP) brain goes `resuming` → `waking` → `ready`, and `/ren/wake` ran before `ready`.                                                                                  |
| 3   | `core/test/brain-lifecycle.test.ts` | A brain whose process is gone is replaced: `generation` + 1, its busy chat becomes `interrupted`, and a call with the old generation's host token gets 403.                         |
| 4   | `core/test/brain-lifecycle.test.ts` | A wake that does not answer within 60 s (`TestClock`) leads to `replacing`.                                                                                                         |
| 5   | `core/test/brain-lifecycle.test.ts` | Two `start:` runs for two chats of one asleep space brain: both chats start, and only one sandbox is created.                                                                       |
| 6   | `core/test/brain-lifecycle.test.ts` | A crash of the run between `creating` and `booting` (interrupt the fiber, start a new runner): the run continues and reuses the sandbox made before the crash.                      |
| 7   | `core/test/keep-alive.test.ts`      | Under `TestClock`: a busy chat whose counter changes keeps extending; a busy chat without change for 30 min gets the idle window; `keepAlive` is called only under half the window. |
| 8   | `core/test/brain-lifecycle.test.ts` | Cleanup destroys the sandbox of a brain with all chats archived, and not of a brain with one unarchived chat.                                                                       |
| 9   | `core/test/session.test.ts`         | `Session.create` returns before the brain is up; the first message is delivered once the brain is `ready`.                                                                          |
| 10  | live, skipped without `E2B_API_KEY` | `layerE2B`: create (asks the user first, README §7), connect, keepAlive, pause by timeout, connect resumes, destroy. Every sandbox carries `{ owner: "ren-v2-dev" }`.               |
| 11  | `core/test/brain-lifecycle.test.ts` | A provider `Failed` on connect retries and never replaces; `Gone` replaces.                                                                                                         |
| 12  | `core/test/brain-lifecycle.test.ts` | Three boot failures in a row give `failed`; Retry resets the count. A capacity error does not count.                                                                                |
| 13  | `core/test/brain-lifecycle.test.ts` | A `gone` event marks the brain's busy chats `interrupted` without an access.                                                                                                        |
| 14  | `core/test/brain-lifecycle.test.ts` | A start run gives up when the brain is `failed`, and when the creator was removed from the space.                                                                                   |
| 15  | `core/test/brain-lifecycle.test.ts` | Cleanup destroys the sandbox of a brain in an archived space, and a provider sandbox whose `brain` row was deleted.                                                                 |
