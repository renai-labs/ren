# Brains on ECS: spike

Status: not started. Do it after [the spec](../README.md). The hand design does not depend on it.

Goal: decide if a brain can run as a Bun process on AWS ECS, always on, with its hands on E2B (a managed brain provider without `canColocate`).

## 1. Why not a Durable Object first

1. **Memory.** With a remote hand, OpenCode still writes shell output and saved tool output to the brain machine's `global.data` (OpenCode #56466; fix PR #56524 is open). In workerd, `/tmp` is isolate memory: six large outputs reached 137 MB against the 128 MB Workers limit. The same 128 MB holds OpenCode and every chat of a space brain.
2. **Egress.** A Durable Object's `fetch()` has no proxy setting, and a Worker cannot trust Ren's egress CA. The brain would need real keys for models and real OAuth tokens for MCP servers (secrets mode "real tokens", EN9). A Bun process uses `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`, so nothing changes.

## 2. What OpenCode runs where

OpenCode runs a session's tools through its `WorkspaceDriver` when the session has a workspace. Ren's driver is `cell/src/harness/opencode/workspace-driver.ts`.

| OpenCode service           | Feature                                   | With a workspace | Evidence (`~/Documents/opencode/packages/core/src`)  | Ren with a remote hand (EN13)            |
| -------------------------- | ----------------------------------------- | ---------------- | ---------------------------------------------------- | ---------------------------------------- |
| Environment (files, spawn) | read, write, edit, shell tools            | hand             | `environment/environment.ts:22-33`                   | —                                        |
| Ripgrep, FileSystemSearch  | grep, glob, @-mention search              | hand             | `ripgrep.ts:105-120`, `filesystem/search.ts:187-189` | `rg` replaced (`workspace-driver.ts:92`) |
| stdio MCP                  | MCP servers started as commands           | hand             | `mcp/stdio.ts`                                       | —                                        |
| Shell output file          | full output of a command                  | brain machine    | `shell.ts`                                           | `RenShell` (today)                       |
| ToolOutput                 | full output of a truncated tool result    | brain machine    | `tool-output.ts:56-57`                               | `RenToolOutput`                          |
| FileSystem                 | the workspace panel's file list and reads | brain machine    | `filesystem.ts:114-119` (OpenCode #44568)            | `RenFileSystem`                          |
| Vcs, Git                   | the workspace panel's branch and diff     | brain machine    | `vcs.ts:261`, `git.ts:1312`                          | `RenVcs`                                 |
| Snapshot                   | revert of file changes                    | brain machine    | `snapshot.ts:77-96`                                  | `RenSnapshot`                            |

OpenCode's own workerd profile turns three of these off instead: Snapshot does nothing, Vcs is empty, FileSystem fails (`opencode/packages/server/src/workerd.ts:84-91`).

## 3. `RenToolOutput`

Built like `RenShell`. It gets the chat's hand from the same function (`workspace-driver.ts:95`). It loads only with `REN_HAND_PLACEMENT=remote`.

| Case                 | Behaviour                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The chat has a hand  | Write the full output through the hand's files to `<global.data>/tool-output/tool_<id>`, the same root as `RenShell`. |
| The chat has no hand | Save no file. The marker says that the output is truncated and gives no path. Do not fail.                            |
| The write fails      | Return the truncated result with a marker that says the full output could not be saved.                               |
| Cleanup              | None in the brain. The files go with the hand.                                                                        |

Ren can remove `RenToolOutput` when it upgrades to an OpenCode that has #56524. Ren does not wait for it.

## 4. Options

| Option                           | What                                                                                                                  | Ren seam                 | Open                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| A. celld on ECS                  | Deno's Durable Object runtime with today's cell                                                                       | a managed brain provider | The 128 MB limit (§1). Several nodes. Outbound traffic through the egress. |
| **B. Brain node on ECS (spike)** | One Bun brain process per brain on shared tasks, as `LocalSandbox` runs brains (`core/src/sandbox-provider/local.ts`) | a managed brain provider | Memory per brain process; the rows of §2; egress per process.              |
| C. One ECS task per brain        | A Fargate task per brain                                                                                              | a managed brain provider | Cost of an always-on task per space; start time after a crash.             |

## 5. Lifecycle states that break in B and C

| State                                        | What breaks                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mid-turn during a deploy or task replacement | The brain's SQLite is on the task's own disk. A restore from Postgres has only what sync sent; sync sends at most every 5 min while a chat is busy (`brain/src/opencode-sync.ts:88`). |
| Task crash                                   | Every brain on the task restores on another task, with the same loss.                                                                                                                 |

## 6. Spike

Done when each question has an answer with a number or a passing check:

1. Memory of one Bun brain process (`cell/src/bun.ts`) with no local executor: idle, and with 5 chats that run tool calls on a remote hand.
2. The OpenCode process with the four replacements of EN13: the Chat API suites pass.
3. `RenToolOutput` (§3): a tool result over 2000 lines or 50 KB is saved on the hand, and the read tool reads the saved path.
4. Egress: each brain process has `HTTPS_PROXY` with its own login from `SandboxEgress.proxyFor` (`core/src/sandbox-egress.ts`). The task's subnet has no route to the internet, so the egress is the only way out.
