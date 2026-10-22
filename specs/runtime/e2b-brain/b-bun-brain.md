# Piece B: Bun brain with native tools, serving many sessions

Status: spec written. Decisions: E5, E6, E7, E18–E31, E38–E41, E85, E89–E92, E94 (README §6). It also uses E26 (client token), E32 (wake) and E37 (generation), which other pieces sign or drive.

## Goal

The brain runs as a Bun process in a sandbox. One brain serves one session or all sessions of a space (E4, E5). OpenCode runs its tools natively on the sandbox disk, and each session works in its own directory. The same brain code also runs on the workerd host (E40).

Not in this piece:

- Token signing and claims (piece C). B reads the claims that C defines: `brain`, `sid`, `generation`.
- Sandbox create, resume, keep-alive and replace (piece D).
- Restore when Ren starts a lost brain (piece E).
- Harness-neutral sync (piece J). B moves sync behind host services but keeps OpenCode rows.

## Layers (E29)

```
 ┌──────────────────────────────────── brain process ────────────────────────────────────────┐
 │ RenBrain core (no harness or host types)                                                   │
 │   Entry checks (E41) · Chat API + per-chat check (E26) · Brain API · Scheduler jobs        │
 │   HotReload pull (E28) · BrainSettings merge (E22) · Reconcile · Sync orchestration         │
 │              │ Harness interface                          │ Host services                   │
 │   ┌──────────▼───────────────────┐            ┌───────────▼────────────────────────────┐    │
 │   │ OpenCode adapter             │            │ Bun host            │ workerd host       │    │
 │   │  Ren plugin, one per Location│            │  Bun.serve          │  worker + DO       │    │
 │   │  event translation           │            │  fiber Scheduler    │  alarm Scheduler   │    │
 │   │  OpenCode rows for sync      │            │  bun:sqlite         │  DO storage        │    │
 │   └──────────────────────────────┘            └────────────────────────────────────────┘    │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Services and layers

| Service           | Contract                                                                                                   | Bun layer                                                                                         | workerd layer                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `Brain.Info`      | brain id, vars                                                                                             | `REN_BRAIN_ID`, `REN_BRAIN_GENERATION`, `BRAIN_PUBLIC_KEYS`, `REN_URL` (set by piece D at create) | Durable Object name = brain id (E40)                  |
| `Scheduler`       | `job(name, run)`: runs at boot, coalesces, the run returns its next delay; `trigger(name)`                 | fiber that sleeps until the earliest due job                                                      | Durable Object alarm set to the earliest due job      |
| `BrainStorage`    | key-value: model access, host token, public key list (E46), settings per session, restore flag per session | `bun:sqlite` at `/home/user/.ren/brain.db`                                                        | Durable Object storage                                |
| `HarnessStorage`  | where the harness keeps its database                                                                       | path `/home/user/.ren/opencode.db`                                                                | Durable Object SQL                                    |
| `ToolHost`        | whether the host can run tools natively                                                                    | `Native`                                                                                          | `None`                                                |
| `Entry`           | one shared check function (E41), then host routing                                                         | `Bun.serve`, one port, ready gate                                                                 | `worker.ts`, routes to the Durable Object by brain id |
| `HotReload`       | `pull`, `latest(sessionId)`                                                                                | one layer on `RenHostApi` `/host/pull`                                                            | same                                                  |
| `Harness.Service` | unchanged interface; one Location per session                                                              | OpenCode process profile on `HarnessStorage`                                                      | OpenCode workerd profile on `HarnessStorage`          |

The harness and sync ask only for these services. They never take `DurableObjectStorage` (today: `harness/opencode/server.ts:34`, `cell/src/sync.ts:84`, `cell/src/cell.ts:32`).

## Behaviour

### Sessions and tools (E18, E19)

- A session without an environment works in `/home/user/workspace/<sessionId>`. OpenCode gives it its own Location.
- With `ToolHost = Native`, OpenCode's own tools stay and run in that directory. The Ren plugin removes them only when `ToolHost = None` and the session has no environment (today's `plugin.ts:179` rule, per session).
- A session with an environment template uses the workspace driver, as today. Tool placement is per session.

### Settings (E21, E22, E24, E28)

- The Ren plugin keeps settings per Location: agent list, instructions, permissions, model, `interactive`. Child sessions use their root's.
- `HotReload.pull` sends one `/host/pull` request per brain and saves each session's resolved copy in `BrainStorage`.
- The plugin installs a session's copy only when the session is not busy, not waiting on a permission or form, and not retrying (ren-v1 INV-38). It does nothing when the copy is unchanged (ren-v1 OI-10).
- At turn end the plugin calls `HotReload.trigger`, then installs.
- `brain.start` pulls before it creates a session.
- The model list is per Location too and is installed at turn end; a credential is removed only when no Location uses its endpoint (E64, piece F).
- `Harness.Instance.sessions` gains `progress`, an opaque counter (OpenCode's event counter), for keep-alive (E72, piece D).

### Scheduler jobs (E27, E38)

| Job       | When                                                                                       | Does                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sync      | OpenCode session events (1 s debounce), every 30 s, backoff 1 s to 5 min after a failure   | today's `Sync.step`; skips sessions being restored and their children; parents first. Never uploads a chat whose local counter is lower than Ren's checkpoint: flags it for restore (E90). Marks a chat with a row over the body limit "cannot sync" and goes on with the others; the step does not count as failed (E91). |
| pull      | every 30 s, at each turn start (E94) and turn end, on wake, on `ModelsNotConfigured` (E60) | `HotReload.pull`; the request reports each chat's `busy` and `progress` (E72) and the brain's version (E89). The reply marks archived chats; the brain interrupts their running turns (E85).                                                                                                                               |
| reconcile | every 30 s                                                                                 | interrupt questions unanswered for `PARK_AFTER_MS`, re-send queued, resume unfinished                                                                                                                                                                                                                                      |

The Bun host does not wait on running turns and never closes OpenCode (E6). The workerd host keeps its wait and idle close.

### Boot, wake, shutdown (E38)

1. Boot: open `BrainStorage` → open OpenCode; each Location installs its saved settings from memory, with no HTTP call → OpenCode resumes suspended turns → open the ready gate → start the Scheduler. A failed job retries and does not stop boot (ren-v1 OI-19).
2. Wake: `POST /ren/wake` drops cached model keys, pulls and syncs, then answers 200, also when the pull or sync failed.
3. Shutdown on SIGTERM: close the ready gate (503) → one sync flush of at most 8 s → exit.

### Chat API isolation (E26)

- The entry passes the client token's `sid` to the Chat API.
- The Chat API allows `sid` and its descendants (`Harness.Chat.get`, `children`). Any other session gets 403.
- The event stream keeps only events of allowed sessions. The set grows on `session.created` with an allowed parent. `shell.exited` and `shell.deleted` map to sessions through the shell id seen in `shell.created`.
- `session.status` returns only allowed sessions.
- An event stream ends when its client token expires (`stream.ended`, reason `closing`, E49).

### Rules carried over from ren-v1

- Resolved settings are byte-stable: sorted, no timestamps, so an unchanged copy installs nothing and the prompt cache stays warm (INV-34).
- One chat's failing settings (for example an unknown agent) never block the pull or the install for other chats (INV-40).
- The brain never deletes a session or its folder (INV-60).
- File tools are denied paths outside the chat's folder (`external_directory`), except `/tmp`, OpenCode's own temp, config and tool-output paths, package caches and reference paths. `/home/user/.ren/` is always denied. The allow rules sit at project scope, so subagents get them (E92; INV-44, INV-45, INV-47).
- The brain reports its version on `/ren/state` and on every `/host` call. When Ren asks, it downloads a newer brain bundle at an idle moment and restarts through the restart loop (E89).

## Contract changes

| Package    | Change                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host-api` | `RenHostApi`: new `POST /host/pull` (E28). `settings.read` is removed. `CurrentHost = { brainId, organizationId, generation }` (E25, E37). `environments.access` and `environments.release` take a session id.                         |
| `host-api` | `SyncApi`: `sync.checkpoints` returns every session of the brain. Session calls already take `:id`; Ren checks `agent_session.brain_id`.                                                                                               |
| `host-api` | `BrainApi`: new `POST /ren/wake`. `brain.configureModels` and `brain.removeModels` are removed: models arrive through the pull (E23). `brain.start`, `brain.send`, `brain.setModel` and `brain.sync` accept any session of this brain. |
| `core`     | `Models.Subject = { brainId, organizationId }` (E23). `Settings` serves `/host/pull` per brain. `SessionSync` scopes by `agent_session.brain_id`. `BrainHost` stops pushing models before start and send.                              |
| `cell`     | the services above; Bun entry next to `worker.ts` (E2); per-session restore flag in `cell/src/sync.ts`; per-Location settings in `harness/opencode/plugin.ts`; per-session directory in `harness/opencode/harness.ts:275`.             |
| `brain`    | `OpenCodeSync` takes a per-session restore check instead of one flag (`brain/src/opencode-sync.ts:254`, `318`).                                                                                                                        |

## Lifecycle states

| State               | What happens                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| restarting (E7)     | Boot order above. Saved settings are in place before OpenCode resumes turns. A crash during a restore keeps only that session's flag; other sessions sync. |
| asleep, then waking | Frozen with the sandbox. Ren calls `/ren/wake` first (E32). The host token from the wake request replaces an expired one (`cell/src/brain.ts:48-55`).      |
| mid-turn            | Settings changes wait for turn end. A busy session uploads at most every 5 min (`busyInterval`).                                                           |
| down (Ren)          | Sync backs off to 5 min. Pull keeps the last copy. Keys stay until they expire. Boot does not need Ren.                                                    |
| replaced (piece D)  | Ren marks busy sessions `interrupted` (E39). Calls from the old generation get 403 (E37); the old brain then fences itself (E51).                          |

## Tests

Write each test first. Each test must fail before its change.

| #   | Package and file                    | Test                                                                                                                                                                                                                                      |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `cell/test/brain-api.test.ts`       | The Brain API suite passes against the Bun entry, started locally, with no VM.                                                                                                                                                            |
| 2   | `cell/test/chat-contract.test.ts`   | The Chat API suite passes against the Bun entry.                                                                                                                                                                                          |
| 3   | `cell/test/tool-parity.test.ts`     | Native tools: a session runs `bash` and edits a file in `/…/workspace/<sessionId>`.                                                                                                                                                       |
| 4   | `cell/test/scheduler.test.ts`       | Bun `Scheduler` under `TestClock`: each job runs once at boot; a trigger during a run gives exactly one more run; a job's returned delay sets its next run.                                                                               |
| 5   | `cell/test/entry.test.ts`           | A token for another brain gets 403; a host token gets 401; a client token on `/ren` gets 403; a body over 16 MB gets 413; `OPTIONS` on `/chat/*` gets CORS headers; a request before the ready gate opens gets 503. Run for both entries. |
| 6   | `cell/test/chat.test.ts`            | Two sessions on one brain: a client token for A gets 403 for B's messages, prompt and shells, and its event stream carries none of B's events. A child of A is allowed.                                                                   |
| 7   | `cell/test/settings.test.ts`        | Two sessions with different agents and `interactive` flags on one brain: starting B does not change A's agent list or permission check.                                                                                                   |
| 8   | `cell/test/settings.test.ts`        | A pull that changes A's rules while A is busy is installed only after A's turn ends. An unchanged copy installs nothing.                                                                                                                  |
| 9   | `cell/test/crash.test.ts`           | Stop the Bun process during a turn and start it again with Ren unreachable: the turn resumes under the saved settings, then sync drains when Ren returns.                                                                                 |
| 10  | `server/test/opencode-sync.test.ts` | A crash during the restore of B leaves only B flagged: the next step uploads A and skips B and its children.                                                                                                                              |
| 11  | `core/test/settings.test.ts`        | `/host/pull` with current hashes returns no bodies. A changed space layer is returned once for a brain with 3 sessions. Each session gets its primary agent.                                                                              |
| 12  | `core/test/session-sync.test.ts`    | A host token for brain X cannot start an upload for a session of brain Y. `sync.checkpoints` returns every session of brain X.                                                                                                            |
| 13  | `cell/test/brain-api.test.ts`       | `POST /ren/wake` returns 200 after a pull and a sync, and returns 200 when Ren is unreachable.                                                                                                                                            |
| 14  | `cell/test/shutdown.test.ts`        | SIGTERM closes the gate (503) and finishes one sync flush within 8 s.                                                                                                                                                                     |
| 15  | `e2e`, skipped without a key        | Live E2B: the template boots and `/ren/state` answers.                                                                                                                                                                                    |
| 16  | `cell/test/sync.test.ts`            | A chat whose local counter is lower than Ren's checkpoint is not uploaded and is flagged for restore (E90).                                                                                                                               |
| 17  | `cell/test/sync.test.ts`            | A chat with a row over the body limit is marked "cannot sync"; another chat of the brain syncs in the same step, and the job does not back off (E91).                                                                                     |
| 18  | `cell/test/settings.test.ts`        | The same layers resolve to byte-identical settings twice. A chat whose agent is unknown does not stop another chat from installing new settings.                                                                                          |
| 19  | `cell/test/settings.test.ts`        | A pull reply that marks a running chat archived interrupts its turn (E85). A turn start triggers a pull (E94).                                                                                                                            |
| 20  | `cell/test/tool-parity.test.ts`     | A file tool is denied a path in another chat's folder and in `/home/user/.ren`, and allowed in `/tmp` (E92).                                                                                                                              |
| 21  | `cell/test/settings.test.ts`        | A turn in provider retry moves the progress counter (E72): OpenCode records `session.retry.scheduled`.                                                                                                                                    |

Edge cases from ren-v1 that these tests cover: INV-3 (test 9: no HTTP during Location start), INV-38 (test 8), OI-10 (test 8), OI-19 (test 9), INV-42 (test 4), INV-55 (test 10 keeps parents first).
