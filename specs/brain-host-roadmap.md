# BrainHost: what remains

The pending work for hosting agent sessions in cells. Each item says what it needs and when it is done.

## 1. Finish the Cloudflare check

Needs a real Cloudflare deployment and an account with credentials.

- **Long turns.** Cloudflare limits one alarm invocation to 15 minutes of wall time and retries a failed alarm only a few times. Verify a turn longer than reconcile's 10-minute wait budget finishes with no client request.
- **Memory.** Measure an idle cell and a cell during a long turn against Cloudflare's 128 MB limit.
- **Cell name.** Verify `ctx.id.name` is the session id for objects reached with `getByName`.

**Done when:** each of the three has a measured answer on a deployment, and any change it forces is made in the shared worker, not a Cloudflare-only branch.

## 2. Before client tokens reach users

- Allow-list the OpenCode routes a client may call.
- Limit session routes to the token's session and its children.
- Move OpenCode's full API (for the TUI and debugging) behind its own, narrower token scope.

**Done when:** a client token can reach only its own session's routes, and a test lists every forwarded route with the scope that reaches it.

## 3. Sessions in Ren

- Postgres tables for sessions: owner, harness, title, status. ren-v1's `agent_session` is the reference.
- Public endpoints: create a session, send to it (for channels and schedules), and connect (`BrainHost.access`: the cell URL and a client token, refreshed before it expires).
- A harness-neutral client protocol for the app, designed with it: a snapshot (transcript, pending operations, busy, open permissions), then normalized events, plus submit, abort and reply. Cloudflare's `OpenCodeSessionEvent` is the reference. The app never speaks OpenCode's API, so a later harness only has to produce this protocol.
- The first end-to-end test in `packages/e2e`: the Ren server's endpoints drive a cell on a test celld, then the client token from `access` reads the session.

**Done when:** a signed-in user creates a session in the app, chats with it through the cell, and finds it again in the session list.

## 4. Sync

- A cell-to-Ren token, issued by Ren and scoped to one session and to the ingest and key-refresh endpoints.
- Ren's ingest endpoints (checkpoint, sessions, messages, archive) and the messages table, with a 256 KiB row guard that redacts the largest tool outputs first.
- In the cell: read OpenCode's SQLite directly from the alarm (`session_message.seq` as the cursor, `count` and `max(seq)` to detect rewrites), push in bounded batches before reconcile, prune on reverts. Sync never opens OpenCode.
- The session status, derived from execution events (`busy`, `waiting`, `idle`, `error`), sent with each session upsert.
- **Model key refresh.** The `ren` method's `refresh` (`packages/cell/src/harness/opencode/plugin.ts`) fetches a new key from Ren with the cell token instead of failing at expiry, and concurrent refreshes share one request: OpenCode does not lock its refresh.

**Done when:** a long session with tool calls, a revert and a subagent is the same in Postgres as in the cell after a celld restart mid-turn, a revert removes the reverted messages in Postgres, and a turn that outlives its key keeps running.

## 5. Restore and cleanup

- On an empty cell, `start` and `access` import the synced session (`POST /api/experimental/session/import`), parents before children. Import is not idempotent and keeps neither lineage nor queued input; an imported session comes back at `/` and must be moved to `/workspace`.
- A cleanup endpoint: end open streams and in-flight requests, flush sync, close OpenCode, delete the storage (credentials included), answer `destroyed` or `absent`. `BrainHost` gains `delete`.
- A retention job that deletes a session's cell past the retention period, only once sync holds every message.

**Decide first:** the retention period, 7 or 14 days.

**Done when:** after cleanup, opening the session in the app shows its history and the next message continues it; a second cleanup answers `absent`; a cleanup with a TUI attached ends its stream.

## 6. Production

- A celld fleet: a bucket, two or more nodes for fast durable writes, a private network for the internal port.
- A deploy workflow for the worker, and rotation for the token signing keys.
- Telemetry from the cell, with alerts on cell failures.
- A scheduled check that compares message counts with each cell and resyncs on a mismatch.
- Load: memory per cell, cells per node, behaviour when a node is lost.
- CI: run the cell suites on Linux (they need Docker), once GitHub Actions is on for this repository.

## 7. Later

Each is its own spec, on the same Brain API:

- **Hands.** A `WorkspaceDriver` so tools that need a computer (shell, files, terminal) run in a sandbox.
- **Skills, MCP and agents.** Through plugin transforms. Blocking plan mode means removing the `plan` agent with `agent.transform`.
- **Other harnesses.** Claude Code, Codex and others as new adapters that produce the same client protocol. Each brings its own runtime, so each becomes its own deployable package and the cell host moves to a shared one.

## Open decisions

| Decision                                                  | Needed by                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the OpenCode config lives and how it reaches a cell | Skills and MCP           | It also defines the model providers                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Who refreshes a user's own OAuth grant                    | Bring-your-own providers | All of a user's sessions share one grant, one cell each. If every cell refreshes it, the first refresh invalidates the others' refresh token for providers that rotate it. Likely: Ren owns the refresh and hands cells short-lived tokens under the `ren` method. Check whether built-in methods carry data in the credential that must pass through (Codex sets `accountID`). Sign-in flows that open a local callback server cannot run in a cell, so Ren runs them elsewhere |
| Retention period                                          | Restore and cleanup      | 7 or 14 days                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Ask upstream (OpenCode)

- Expose `fetch` on `OpenCodeWorkerd`, so the cell's host (`packages/cell/src/harness/opencode/host.ts`) stops depending on unpublished subpaths.
- Persist pending questions and permission requests across a close.
- The `<context>` blocks in `<system-update>` reach the model HTML-escaped; check whether that is intended.
- The 2.0.27 client's `session.synthetic` is refused with "Expected string" where the same raw request is accepted.

## Housekeeping

- `packages/cell/test/smoke.test.ts` restarts a celld container within Bun's default 5-second timeout and can time out under the load of the full suite; give it a longer timeout.
