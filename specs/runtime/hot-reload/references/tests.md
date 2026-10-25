# Hot reload: tests

Each test checks the interaction of two or more lifecycles. The runs that must pass before a merge, and the chaos cases on the real stack, are in [`../spec.md` §9](../spec.md#9-verification). Write each test first; it must fail before its change. Use real components, latches and `TestClock`; use no mocks and no real-time waits (root `AGENTS.md`).

## 1. Lifecycles

| Entity     | States                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brain      | asleep (E2B paused, cell closed), waking, open and idle, mid-turn (step running, tool call running, waiting for a permission or a question, subagent running), down, restarting, retired generation |
| Ren server | up, down, restarting (the `LISTEN` connection drops)                                                                                                                                                |
| Push       | delivered, lost, duplicated, arrives during a pull                                                                                                                                                  |
| Pull       | idle, running, slow (up to 10 s), failed                                                                                                                                                            |
| MCP server | pending, connected, call running, failed, needs_auth (401), changed, removed, tools changed                                                                                                         |
| Credential | connected, refreshed, revoked, reconnect needed                                                                                                                                                     |
| LiteLLM    | up, down, model added, model removed, key expired                                                                                                                                                   |
| Chat       | idle, busy, steer, queued, archived, deleted                                                                                                                                                        |

## 2. Invariants

Every test checks the invariants that apply to it.

| ID  | Must hold                                                                                                                                       | Catches            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| I1  | 30 s after the last write, every open brain has Ren's state: MCP servers, settings, env var names, model list                                   | stale state        |
| I2  | A pull that reads after a commit returns that commit                                                                                            | lost update        |
| I3  | At most one more pull for each running pull. When the content is the same: no storage write, no harness reload                                  | storm              |
| I4  | A pull ends in 10 s, a push in 2 s, an MCP connect in its startup plus catalog time. No tool call waits forever                                 | hang               |
| I5  | The pull lock is never held while the brain waits for an MCP connect, a turn or Ren. The alarm never waits for a pull                           | deadlock           |
| I6  | A push never resumes a paused sandbox and never extends its keep-alive                                                                          | wake by hot reload |
| I7  | Each chat ends idle or interrupted. No chat stays busy or "Asking". No server stays down after its credential works and a prompt or a retry ran | dead state         |
| I8  | The same state gives the same system prompt bytes                                                                                               | prompt cache loss  |

## 3. Package tests

### 3.1 Push and pull

| #   | Interaction                                                                       | Must hold                                                                                                                   | Origin                               | Where                          |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------ |
| 1   | A push arrives while a pull is between its read and its apply                     | Exactly one more pull; it returns the write (I2, I3)                                                                        | ren-v1 `manifest-driver.ts:51`; HR13 | `cell/test/hot-reload.test.ts` |
| 2   | 100 pushes in 1 s                                                                 | 2 pulls or fewer (I3)                                                                                                       | HR13                                 | same                           |
| 3   | A write commits; another write rolls back                                         | Only the commit sends a `NOTIFY`. The brain reads the rows after the commit                                                 | HR10                                 | `core` (Postgres)              |
| 4   | Sync upload; archive; agent change; delete; a space delete that cascades to chats | Sync sends no `NOTIFY`; each other write sends one                                                                          | HR23                                 | `core`                         |
| 5   | One transaction writes 1000 rows of one space                                     | One notification                                                                                                            | HR10                                 | `core`                         |
| 6   | The `LISTEN` connection drops; writes occur; it connects again                    | The listener listens again. Brains get the writes by pull in 30 s (I1)                                                      | HR10                                 | `core`, `TestClock`            |
| 7   | Two server instances listen                                                       | Each brain gets two pushes and does two pulls or fewer                                                                      | HR10                                 | `core` and `cell`              |
| 8   | `notify` on a paused, an awake and a down sandbox                                 | Paused: no `connect`. Awake: `keep_alive_until` does not change. Down: ends in 2 s and does not delay other brains (I4, I6) | HR12                                 | `core/test/brain-host.test.ts` |
| 9   | A push reaches a cell whose host token expired                                    | The cell keeps the new `ren-host-token`; its pull works                                                                     | HR17                                 | `cell/test/brain-api.test.ts`  |
| 10  | A push or a pull reaches a retired generation                                     | Nothing is applied                                                                                                          | `cell/src/hot-reload.ts:59`          | `cell`                         |

### 3.2 Pull content

| #   | Interaction                             | Must hold                                                                                        | Origin                                     | Where  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------ |
| 11  | Two pulls with the same full state      | No storage write; no agent, provider, MCP or skill reload; the same system prompt bytes (I3, I8) | ren-v1 OI-10, INV-34; HR9                  | `cell` |
| 12  | Dropped: no brain from before HR9 runs  |                                                                                                  | HR30                                       |        |
| 13  | A pull fails after the catalog is saved | Nothing is half applied; the next pull completes it                                              | exists: `cell/test/hot-reload.test.ts:275` | keep   |

### 3.3 Brain lifecycle

| #   | Interaction                                                                      | Must hold                                                                                             | Origin                      | Where                                 |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------- |
| 14  | Pause; write settings, env vars, catalog and a LiteLLM model; resume; first turn | That turn uses all new state, the model list too                                                      | ren-v1 INV-15, INV-29; HR26 | `cell` Bun brain; chaos `e2b.test.ts` |
| 15  | Wake while Ren is down                                                           | The wake answers; the next `start` or `send` pull repairs the state; the brain does not stay "waking" | ren-v1 INV-13, INV-14       | `cell`                                |
| 16  | Boot while the first pull fails                                                  | The brain pulls every 1 s until it works, then continues                                              | ren-v1 OI-19                | `cell`                                |
| 17  | Crash mid-turn; the catalog changes while the brain is down                      | The boot uses the stored state, waits for MCP, resumes the turn and applies the new catalog           | ren-v1 INV-19, INV-20       | `cell/test/crash.test.ts`             |
| 18  | A push reaches a closed cell                                                     | It opens, pulls and closes when idle. No turn starts. One alarm, not two                              | ren-v1 INV-42; HR12         | `cell/test/alarm.test.ts`             |
| 19  | A 40 min turn in a cell; the catalog changes at 5 min                            | Applied in 30 s by the alarm pull; the alarm wait continues (I5)                                      | HR17                        | same, `TestClock`                     |
| 20  | Ren answers each alarm pull after 10 s                                           | The alarm returns at once; pulls do not stack (I3, I5)                                                | HR17                        | same                                  |

### 3.4 MCP servers

| #   | Interaction                                                                | Must hold                                                                            | Origin                              | Where                                    |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------- |
| 21  | A server is added while a call to another server runs                      | That call ends normally; the new tools appear at a later step                        | HR1                                 | `cell/test/mcp.test.ts` (McpPeer `hold`) |
| 22  | A server's URL or header changes during a call to it                       | The call ends with a tool error; the turn continues (I4, I7)                         | HR1                                 | same                                     |
| 23  | A server is removed during a call to it                                    | The call ends and does not hang; the tool is gone at the next step                   | HR1                                 | same                                     |
| 24  | A slow server is added (`holdInitialization`); a settings push arrives     | The pull returns at once; the settings apply before the server connects (I5)         | HR19                                | same                                     |
| 25  | Boot with a slow server and a good server                                  | The first turn waits up to startup plus catalog time, then runs with the good server | exists: `cell/test/mcp.test.ts:223` | keep                                     |
| 26  | 401; the person connects again; next prompt                                | The prompt's retry connects the server; connected servers are not restarted          | exists: `cell/test/mcp.test.ts:174` | keep                                     |
| 27  | The person connects again while a timed retry runs                         | One reconnect. Retries come at 10 s, 1 min, 5 min, then stop                         | `mcp.ts:213`; ren-v1 INV-86         | `TestClock`                              |
| 28  | The catalog changes between the retry's skip, reload and unskip            | The applied servers are the newest catalog (I1)                                      | `mcp.ts:201-210`                    | latch                                    |
| 29  | A server fails and recovers again and again during the retries             | One retry fiber at a time; it stops when no server is down                           | `mcp.ts:213-214`                    | `TestClock`                              |
| 30  | The egress refreshes a token mid-turn                                      | Calls continue; no reload                                                            | ren-v1 DS-T5, OI-7                  | `core` egress, `cell` reload count       |
| 31  | The environment is replaced during a turn that uses a local (stdio) server | The server fails, then recovers on a retry after the environment returns             | `02382baf1`                         | chaos `executor-docker.test.ts`          |

### 3.5 Models

| #   | Interaction                                                   | Must hold                                                                                                             | Origin                                           | Where                                       |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| 32  | LiteLLM adds a model; a `start` names it before the next read | `refreshModels` runs; the start is accepted                                                                           | HR14                                             | `cell`, a `/model/info` server              |
| 33  | LiteLLM removes the model mid-turn                            | The next request fails with a classified error; the next turn uses the settings' model and shows a message            | extend `cell/test/settings.test.ts:735`          | same                                        |
| 34  | LiteLLM is down at boot, with and without a stored list       | With the list: models work. Without it: a clear error, and recovery when LiteLLM returns. Never without a key forever | ren-v1 DS-T4, OI-5                               | `cell`                                      |
| 35  | LiteLLM is down, then up, mid-turn                            | The last list stays; models do not go and come back                                                                   | `opencode/core/src/plugin/provider/local.ts:124` | `cell`                                      |
| 36  | The base URL changes in the pull mid-turn                     | The next request uses the new URL                                                                                     | REN-1486, `cell/test/brain-api.test.ts`          | keep                                        |
| 37  | `Models.fromLiteLLM`                                          | Drops fallback copies; maps limits and modalities; a model with no modalities is text only                            | ren-v1 OpenCode quirks; HR15                     | `schema` unit                               |
| 37a | Ren's picker and a running brain read the same key's models   | The same model ids and variants in both lists (I1)                                                                    | HR28                                             | `core` and `cell`, one `/model/info` server |
| 37b | A cell's LiteLLM key nears its expiry mid-turn                | `models.refresh` renews it; the next request works; the model list does not change                                    | HR29; exists: `cell/test/model-refresh.test.ts`  | keep                                        |

### 3.6 Settings, env vars and chats

| #   | Interaction                                                   | Must hold                                                                            | Origin                                          | Where                        |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------- |
| 38  | An agent changes mid-turn; a subagent of a removed agent runs | The next step uses the new instructions; the subagent fails and the parent continues | HR21                                            | `cell/test/settings.test.ts` |
| 39  | A permission becomes stricter during a step                   | The next tool call in the same step is refused                                       | HR21                                            | same                         |
| 40  | A permission or question waits while settings change          | Nothing is disposed; the question can still get an answer                            | ren-v1 INV-38, INV-65                           | same                         |
| 41  | A queued message waits while settings change mid-turn         | The queued message runs with the new settings                                        | HR1 (replaces `cell/test/settings.test.ts:126`) | same                         |
| 42  | An env var is removed mid-turn, in a cell and in a Bun brain  | A running process keeps it; the next process does not have it                        | HR18                                            | `cell/test/env.test.ts`      |
| 43  | A busy chat is archived                                       | The push interrupts the turn in 2 s; no model request after that                     | ren-v1 OI-20; HR23                              | `cell` and `core`            |
| 44  | A busy chat is deleted; `TestClock` moves 7 days              | The turn is interrupted, the chat is dropped, the folder goes after 7 days           | HR22, E114                                      | `cell`                       |
| 45  | A chat is deleted while its brain is asleep                   | The wake drops the chat; no sync error repeats                                       | ren-v1 INV-60                                   | `cell`                       |

## 4. Seeded sequences

Prior art: `packages/e2e/chaos/cases/lifecycle-chaos.test.ts`.

| Item     | Value                                                                                                                                                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions  | Write settings, env vars or catalog. Add, remove or change an MCP server. Upstream refuses with 401, then accepts. LiteLLM adds or removes a model, goes down, comes up. Drop a push. Ren down, up. Pause and resume (E2B), close and open (cell). Crash the brain. Start a turn, steer, queue, archive, delete, interrupt |
| Sequence | Seeded, 20 actions, `CHAOS_SEQUENCES` seeds                                                                                                                                                                                                                                                                                |
| Check    | After 30 s without actions: I1 to I8 for each brain and chat                                                                                                                                                                                                                                                               |
| Hosts    | The same seeds on `cell`, `cell-docker`, and `e2b` when its credentials are set. A seed gives the same result on each host                                                                                                                                                                                                 |

## 5. User journeys

Playwright, in `packages/e2e/tests`.

| #   | Journey                                                                                                                                     | Origin             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| U1  | The agent asks to connect Linear. The person connects it and sends "now use it" as a steer. The Linear tool works in the same turn          | HR1                |
| U2  | An admin changes an agent in another tab. The next turn of an open chat uses the change; the app's agent list changes without a page reload | ren-v1 `4250f948b` |
| U3  | A model added in LiteLLM appears in the picker; a chat started with it works                                                                | HR14, HR15         |
