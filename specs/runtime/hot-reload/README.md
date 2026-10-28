# Hot reload: pending

Hot reload sends a change in Ren (a setting, an env var, an app, a model, a chat state) to a brain that runs, without a restart. It is built (PR #57): Ren pushes `POST /ren/pull`, and the brain pulls the full state with `POST /host/pull`.

## 1. Tests not written

Write each test first; it must fail before its change. Use real components, latches and `TestClock`.

| #   | Case                                                            | Expected                                                                                                                                        | Package        |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 7   | Two server instances listen                                     | Each brain gets two pushes and does two pulls or fewer                                                                                          | `core`, `cell` |
| 15  | Wake while Ren is down                                          | The wake answers; the next `start` or `send` pull repairs the state; the brain does not stay "waking"                                           | `cell`         |
| 16  | Boot while the first pull fails                                 | The brain pulls every 1 s until it works, then continues                                                                                        | `cell`         |
| 28  | The catalog changes between the retry's skip, reload and unskip | The applied MCP servers are the newest catalog                                                                                                  | `cell`         |
| 30  | The egress refreshes a token mid-turn                           | Calls continue; no reload                                                                                                                       | `core`, `cell` |
| 33  | LiteLLM removes the model mid-turn                              | The next request fails with a classified error; the next turn uses the settings' model and shows a message. Also confirm the message in the app | `cell`         |
| 36  | The base URL changes in the pull mid-turn (brain side)          | The next request uses the new URL                                                                                                               | `cell`         |
| 38  | An agent changes mid-turn; a subagent of a removed agent runs   | The next step uses the new instructions; the subagent fails and the parent continues                                                            | `cell`         |
| 39  | A permission becomes stricter during a step                     | The next tool call in the same step is refused                                                                                                  | `cell`         |
| 40  | A permission or question waits while settings change            | Nothing is disposed; the question can still get an answer                                                                                       | `cell`         |
| 44  | A busy chat is deleted; `TestClock` moves 7 days                | The turn is interrupted, the chat is dropped, the folder goes after 7 days                                                                      | `cell`         |
| 45  | A chat is deleted while its brain is asleep                     | The wake drops the chat; no sync error repeats                                                                                                  | `cell`         |
| —   | Key rotation, brain side (`cell/test/crash.test.ts`)            | After a rotation and a restart, a token signed with the new key is accepted before the first pull                                               | `cell`         |
| —   | Host token renewal point                                        | The brain renews at 1 h left (`cell/src/host-token.ts:11`). The test at `cell/test/host-access.test.ts:172` uses 120 s and says "five minutes"  | `cell`         |

Chaos cases on the real stack:

| #   | Case                       | State                                                          | Expected                                                                               |
| --- | -------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| C2  | Env var push               | mid-turn with a running process                                | The running process keeps the old env; the next process has the new env in 2 s         |
| C3  | Catalog pull               | mid-turn, a long turn; the lane sets `PULL_INTERVAL_MS` to 2 s | An added server's tools appear in one pull interval, without a push                    |
| C8  | MCP server change mid-call | a call held by `McpPeer`                                       | The call ends with a tool error; the turn continues; the next step uses the new server |
| C9  | MCP reconnect              | upstream answers 401, then 200 after a credential change       | The next prompt connects the server; other servers are not restarted                   |

User journeys, deferred:

| #   | Journey                                                                                                                                     | Waits for                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| U1  | The agent asks to connect Linear. The person connects it and sends "now use it" as a steer. The Linear tool works in the same turn          | a Linear sign-in in a run  |
| U2  | An admin changes an agent in another tab. The next turn of an open chat uses the change; the app's agent list changes without a page reload | an agent editor in the app |

## 2. Other

1. **A model key per brain.** Ren mints one `MODELS` key per brain. Then the grant holds one LiteLLM key, and `ModelRefresh.anyEndpoint` (`cell/src/model-refresh.ts:13`) and the first-key fallback go.
2. **The 3 `openai` models without `mode`** are not run on LiteLLM: the local LiteLLM has no OpenRouter key. Run one turn on each once it has one.
3. **Stale lists in the app.** The app loads a chat's model, agent and skill lists once per open (`chat/src/atoms.ts:185`), so a change shows only after a reload.
4. **Flaky tests.** The `BrainPush` reconnect test and the real-stack chaos file fail under load or after an earlier test hangs.
5. **Fan-out.** A Ren-wide write opens every cell once per server instance.
