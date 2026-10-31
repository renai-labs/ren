# Brain: pending

A brain runs as a Bun process in an E2B sandbox; one brain serves a session or every session of a space, and its tools run natively in the same sandbox. Pieces A to I are built: brain identity and scope, the Bun brain, Ed25519 tokens, the sandbox host, restore on access, models (LiteLLM), the E2B template and the environment choice.

## 1. Status

| Item                            | Status       |
| ------------------------------- | ------------ |
| Harness-neutral sync (§3)       | Not started  |
| Restore leftovers (§4)          | Not done     |
| Live E2B tests (§5)             | Not written  |
| E2B environment provider (§6)   | Not built    |
| Environment retries (§7)        | Not built    |
| References (§8)                 | Open         |
| Models and harnesses (§9)       | Not designed |
| Upstream asks to OpenCode (§10) | Not sent     |

## 2. How to work

The loop, one piece at a time:

1. **Read.** Read this file and the code of the piece. Do not write a spec yet.
2. **Discuss.** With the user, go through the piece: situation, model (ASCII), issue, options, recommendation. Ask each decision with the question tool, after the situation. Record each decision in the spec.
3. **Arrive at contracts.** Agree the piece's services (interfaces and errors), their layers and implementation details, and changes to shared contracts (`host-api`, `schema`, `protocol`, `db`). Check every lifecycle state the piece touches: asleep, waking, mid-turn, down, restarting.
4. **Write the piece spec**: goal, services and layers, contract changes, lifecycle states, and the list of tests, edge cases included.
5. **Proceed** to the next piece.

Implementation starts only when the user says so. Then agents implement from the spec: tests first, each test fails before its change.

Rules for every piece:

- Every replaceable part is a service with one or more layers: harnesses, brain hosts, sandboxes, environments, models, tokens, storage, scheduling. Code asks for the service. Only a composition root chooses a layer.
- Check each claim against the code and give `file:line`. Look for prior art in OpenCode and `repos/effect` before a new pattern.

## 3. Harness-neutral sync (piece J)

Needed before a second harness (Pi, Claude Code, Codex). Today Ren stores OpenCode rows end to end: `opencode_session`, `opencode_message` and `opencode_inbox` (`db/src/session.sql.ts:74`, `:108`, `:127`), and the brain's `Transcript.restore` takes `Sync.OpenCodeSessionRow` (`cell/src/harness/harness.ts:137`).

Decisions:

- **E30.** Each harness owns its transcript format. Sync is a harness capability: the adapter produces rows and restores them. Ren stores rows tagged with the harness. Ren core reads only neutral columns on `agent_session` (title, status, updated time), which sync fills. Why: swapping in Pi needs a Pi codec, not changes in core, db and the app.
- **E31.** Sync copies rows (session and messages), not the harness's event log, and runs on harness events. Piece J checks whether only the rows changed since the last commit can be sent; if yes, the 5-min throttle while busy goes away (`brain/src/opencode-sync.ts:87`). Why: OpenCode v2 has no history or replay API, and its migrations clear the event table.

Scope: brain core defines the `Transcript` contract (`changed`, `rows`, `summary`, `restore`); each harness adapter meets it by any means (the harness API, its storage, or a plugin inside the harness).

## 4. Restore leftovers

1. Sync never writes `agent_session.harness_version`; Ren reads it (`core/src/session-sync.ts:231`) and gives the codec `null`.
2. Folder removal on a template's machine is not done: Ren cannot give access for a deleted chat. Rule: the brain removes a deleted chat's folder only when the hand is `managed` (made by Ren) and only after Ren has named the chat deleted in pulls for 7 days.
3. Queued file attachments are not queued again by a restore: the stored payload differs from the prompt input.
4. Messages sent while the brain is not ready are kept in local storage as prompts only. Commands, compactions and queue changes are not kept.
5. The "files are gone" notice reads `filesResetAt` from `session.get`, which the app loads with the page. A reset while the page is open shows after the next load.
6. Tests not written:
   - `core/test/environments.test.ts`: a hand that is not `managed` never gets a folder removal for a deleted chat.
   - A restore skips the descendants of a missing parent (old celld case P5-06).
   - `e2e/chaos/cases/real-stack.test.ts:294` (`test.todo` P5-08): a chat on a template's machine restores, and its next shell call reads a file it wrote before. A chat on the brain's own hand restores and runs `shell` in its workspace folder.

## 5. Live E2B tests

Each runs only with `E2B_API_KEY`, and asks the user before it creates a sandbox.

| Test                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- |
| The template boots and `/ren/state` answers.                                                                                          |
| `SandboxProvider.layerE2B`: create, connect, keep-alive, pause by timeout, connect resumes, destroy.                                  |
| Replace a brain's sandbox, then open its chat: history, subagent chats, queued messages and a shell call all work.                    |
| `bun run template:e2b`: the smoke sandbox answers `/ren/state` and is killed afterwards. A second run with no change skips the build. |
| Ren with address A creates a brain; Ren restarts with address B; the brain syncs to B without a replace.                              |
| A space brain with 5 chats and 2 running shells: log peak memory and CPU of the sandbox.                                              |

## 6. E2B environment provider

`EnvironmentProvider` has only Docker (`core/src/environment-provider/docker.ts`). An E2B provider lets a template's environment run on E2B. The E2B REST calls move to one module that `SandboxProvider.layerE2B` and the E2B `EnvironmentProvider` share.

## 7. Environment retries

1. **Spawn.** If the connection drops during `process.spawn`, the brain cannot tell whether the command started. Fix: an id chosen by the client in `SpawnInput` (`environment-api/src/environment-api.ts:54`), so a retried spawn finds the process it started.
2. **Stdin.** A dropped `process.write` (`environment-api/src/environment-api.ts:240`) cannot be retried safely. Fix: a stdin offset, so the executor ignores bytes it already has.

## 8. References

1. The shell tool can change files under the reference root. The deny rules check only the paths of file tools. Ren copies deleted files again at the next turn.
2. Not measured: all brains send anonymous GitHub lookups through the same egress IP. GitHub can limit anonymous git traffic for each IP.

## 9. Models and harnesses

Not designed yet.

1. **Subscription sign-in** (ChatGPT/Codex, Copilot). Some OpenCode drivers branch on the credential method and read data from it (OpenAI reads `accountID` for ChatGPT), so a subscription token needs its method and metadata to reach OpenCode. Decide together with who refreshes the grant: all of a user's sessions share one grant, and providers that rotate the refresh token invalidate the others' copies after the first refresh.
2. **Other harnesses.** Claude Code, Codex and Pi as new adapters that produce the same Chat API. Needs §3 first.

## 10. Upstream asks (OpenCode)

1. Persist pending questions and permission requests across a close. Today a restore does not bring them back.
2. The `<context>` blocks in `<system-update>` reach the model HTML-escaped; check whether that is intended (seen on 2.0.27).
3. The 2.0.27 client's `session.synthetic` is refused with "Expected string" where the same raw request is accepted.
