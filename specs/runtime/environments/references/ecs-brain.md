# Brains on ECS: spike

Status: not started. Do it after the environments spec ([`../README.md`](../README.md)). The environment design does not depend on it.

Goal: decide if a brain can run as a Bun process on AWS ECS, always on, with its environments on E2B.

## 1. Why not a Durable Object

1. **Memory.** With a remote environment, OpenCode still writes shell output and saved tool output to the brain host's `global.data` (OpenCode #56466; fix PR #56524 is open). In workerd, `/tmp` is isolate memory: six large outputs reached 137 MB against the 128 MB Workers limit. The same 128 MB holds OpenCode and every chat of a space brain. celld runs workerd, so the same limit applies there (not checked on celld).
2. **Egress.** A Durable Object's `fetch()` has no proxy setting, and a Worker cannot trust Ren's egress CA. So the brain cannot send its traffic through the egress as an E2B sandbox does (`core/src/sandbox-provider/e2b.ts:21-25`). The brain would need real keys for models and real OAuth tokens for MCP servers, and Ren would have to send and refresh them (hot reload). A Bun process uses `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`, so nothing changes.

## 2. What OpenCode 2 runs where

OpenCode 2 (`~/Documents/opencode`, `@opencode/core` 2.1.3; Ren pins 2.0.27) runs a session's tools through its `WorkspaceDriver` when the session has a workspace. Ren's driver is `cell/src/harness/opencode/workspace-driver.ts`.

| OpenCode service           | Feature                                                      | With a workspace       | Evidence (`~/Documents/opencode/packages/core/src`) | Ren today                                                    |
| -------------------------- | ------------------------------------------------------------ | ---------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Environment (files, spawn) | read, write, edit, shell tools                               | remote                 | `environment/environment.ts:31`                     | —                                                            |
| ripgrep                    | grep, glob                                                   | remote                 | `ripgrep.ts:105`                                    | binary replaced (`workspace-driver.ts:92`, OpenCode #44552)  |
| stdio MCP                  | MCP servers started as commands                              | remote                 | `mcp/stdio.ts:46`                                   | —                                                            |
| Shell output file          | full output of a command                                     | brain host             | `shell.ts:144`                                      | `RenShell`: the executor writes it (`cell/.../shell.ts:183`) |
| ToolOutput                 | full output of a truncated tool result                       | brain host             | `tool-output.ts`                                    | not replaced                                                 |
| FileSystem                 | Ren's `findFiles` (@-mention search, `cell/.../chat.ts:283`) | brain host             | `filesystem.ts:114-119` (OpenCode #44568)           | not replaced                                                 |
| Pty                        | terminal                                                     | brain host             | `pty.ts:183`                                        | not replaced                                                 |
| Snapshot                   | revert of file changes                                       | brain host (local git) | `snapshot.ts:92-101`                                | not replaced                                                 |
| Vcs                        | git branch and diff                                          | brain host             | stubbed in `server/src/workerd.ts`                  | not replaced                                                 |

On a brain host without the chat's files, each "brain host" row must be turned off or sent to the environment. On today's E2B brain this works only because the brain and the environment share one sandbox.

## 3. `RenToolOutput`

Built like `RenShell`: it gets the chat's environment from the same function (`workspace-driver.ts:95`).

```
ToolOutput.node.replace(RenToolOutput.node((workspaceId) => session(connections, sessionIdOf(workspaceId))))
```

| Case                        | Behaviour                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The chat has an environment | Write the full output through the environment's `overrides.write` to `<global.data>/tool-output/tool_<id>`, the same root as `RenShell`. |
| The chat has no environment | Save no file. The marker says the output is truncated and gives no path. Do not fail: webfetch and MCP tools run without an environment. |
| The write fails             | Return the truncated result with a marker that says the full output could not be saved.                                                  |
| Cleanup                     | None in the brain. The files go with the environment.                                                                                    |

The 2.0.27 `ToolOutput` has `truncate` and `cleanup` only, so `RenToolOutput` copies OpenCode's truncate logic and changes the write. Remove `RenToolOutput` when Ren upgrades to an OpenCode with #56524, and check `RenShell` then.

## 4. Options

| Option                           | What                                                                                                                      | Ren seam                                           | Open                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| A. celld on ECS                  | Deno's Durable Object runtime (`ghcr.io/denoland/celld:0.6.2`) with today's cell                                          | `BrainHost.layerCell`                              | The 128 MB limit (§1). Several nodes. Outbound traffic through the egress. |
| **B. Brain node on ECS (spike)** | One Bun brain process per brain on shared tasks, as `LocalSandbox` runs brains (`core/src/sandbox-provider/local.ts:115`) | a new `SandboxProvider` layer under `layerSandbox` | Memory per brain process; the rows of §2; egress per process.              |
| C. One ECS task per brain        | A Fargate task per brain                                                                                                  | a new `SandboxProvider` layer                      | Cost of an always-on task per space; start time after a crash.             |

## 5. Lifecycle states that break in B and C

| State                                        | What breaks                                                                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mid-turn during a deploy or task replacement | The brain's SQLite is on the task's own disk. A restore from Postgres has only what sync sent, and sync sends at most every 5 min while a chat is busy (`brain/src/opencode-sync.ts:87`). |
| Task crash                                   | Every brain on the task restores on another task, with the same loss.                                                                                                                     |

## 6. Spike

Done when each question has an answer with a number or a passing check:

1. Memory of one Bun brain process (`cell/src/bun.ts`) with no local executor: idle, and with 5 chats that run tool calls on a remote environment.
2. The OpenCode process profile (`OpenCodeServer.openProcess`, `cell/src/harness/opencode/server.ts:99`) with FileSystem, Pty, Snapshot and Vcs turned off or sent to the environment: the Chat API suites pass.
3. `RenToolOutput` (§3): a tool result over 2000 lines or 50 KB is saved on the environment, and the read tool reads the saved path.
4. Egress: each brain process has `HTTPS_PROXY` with its own login from `SandboxEgress.proxyFor` (`core/src/sandbox-egress.ts`). The task's subnet has no route to the internet, so the egress is the only way out.
