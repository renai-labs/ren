# Runtimes

A runtime is the shape a brain runs in: which harness, which host, where its tools run, and whether it serves one session or a whole space. Ren supports several runtimes at once so that we can iterate on them. This file tracks every runtime, what each supports, and every feature flag. Update it in the same change that adds an option, closes a gap or adds or removes a flag.

The design and the build order are in [plan.md](plan.md).

## Rules

- A **runtime** is placement data, not a flag. A space has one; a session pins the runtime it started with and keeps it for life. Changing a space's runtime affects only new sessions.
- A **feature flag** switches one behaviour, is short-lived and is removed when its work ships. Flags are evaluated through OpenFeature, backed by PostHog ([plan.md §2.8](plan.md#28-feature-flags)).
- Code asks for a **capability**, never for a runtime, host or harness by name. Only the server's composition root reads runtime options to choose layers.
- Every gap below has a reason. A gap is closed by building the feature and changing its cell here.

## Axes

| Axis        | Options                                                                                                  | Implemented by                                      |
| ----------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Harness     | `opencode`                                                                                               | `Harness.Service` in `cell`                         |
| Host        | `cell` (a Durable Object on celld or Cloudflare), `docker`, `e2b` (a Bun process in a sandbox)           | `BrainHost.Service` in `core`                       |
| Environment | `none`, `colocated` (tools run natively in the brain's sandbox), `docker`, `e2b` (an executor's sandbox) | `EnvironmentProvider` in `core`, or the host itself |
| Scope       | `session` (one brain per session), `space` (one brain for every session in a space)                      | `BrainHost.Service`                                 |

Combinations that are not valid:

- `colocated` needs a `docker` or `e2b` host.
- A `cell` host serves one session only, so it cannot have `space` scope.
- A `cell` host on Cloudflare cannot use a `docker` environment: Docker's executor listens on `127.0.0.1`.

## Profiles

A profile names one valid combination.

| Profile        | Harness    | Host     | Environment | Scope     | Status                                      |
| -------------- | ---------- | -------- | ----------- | --------- | ------------------------------------------- |
| `cell`         | `opencode` | `cell`   | `none`      | `session` | Built. The default today                    |
| `cell-docker`  | `opencode` | `cell`   | `docker`    | `session` | Built. celld and Docker on one machine      |
| `docker-space` | `opencode` | `docker` | `colocated` | `space`   | Planned. The local stand-in for `e2b-space` |
| `e2b-space`    | `opencode` | `e2b`    | `colocated` | `space`   | Planned. The hot path, and ren-v1's model   |

## Capabilities

✅ works · 🔨 planned, no blocker known · ⚠️ works with a limit · ❌ not possible in this profile

| Capability                                                | `cell`                            | `cell-docker`           | `docker-space`, `e2b-space`           |
| --------------------------------------------------------- | --------------------------------- | ----------------------- | ------------------------------------- |
| Chat: prompt, steer, queue, interrupt, permissions, forms | ✅                                | ✅                      | 🔨                                    |
| Model switch, subagents, revert of messages               | ✅                                | ✅                      | 🔨                                    |
| Read, edit, glob and grep files                           | ❌ no environment                 | ✅ through the executor | 🔨 native                             |
| Shell tool                                                | ❌ no environment                 | ✅ through the executor | 🔨 native                             |
| `@` file search                                           | ❌                                | ⚠️ unverified           | 🔨                                    |
| Interactive terminal                                      | ❌ workerd has no PTY             | ❌ workerd has no PTY   | 🔨                                    |
| Revert of file changes                                    | ❌ Snapshot is a no-op in workerd | ❌ same                 | 🔨                                    |
| Git diff view                                             | ❌ Vcs is a no-op in workerd      | ❌ same                 | 🔨                                    |
| Remote MCP                                                | ⚠️ unverified                     | ⚠️ unverified           | 🔨                                    |
| Local (stdio) MCP                                         | ❌ no process in workerd          | ❌ same                 | 🔨                                    |
| Skills and plugins from disk                              | ❌ precompiled plugins only       | ❌ same                 | 🔨                                    |
| Sync to Postgres                                          | ✅                                | ✅                      | 🔨                                    |
| History survives the loss of the host                     | ✅ Durable Object storage         | ✅ same                 | ⚠️ transcripts only; files need pause |
| Turns longer than 15 minutes                              | ⚠️ unverified on Cloudflare       | ⚠️ same                 | 🔨                                    |
| Messages over 2 MB                                        | ⚠️ celld refuses the row          | ⚠️ same                 | 🔨                                    |
| No cost while idle                                        | ✅ the cell closes                | ✅ same                 | 🔨 pause once every session is idle   |
| The agent cannot read the brain's secrets                 | ✅                                | ✅                      | ❌ they share a machine               |
| One session's crash leaves the others running             | ✅                                | ✅                      | ❌ one process per space              |

`SessionCapabilities.of` in `@ren/schema` computes the flags that clients read. Today it takes only the harness; the plan makes it take the runtime.

## Feature flags

| Key  | Type | Default | What it switches | Issue | Remove when |
| ---- | ---- | ------- | ---------------- | ----- | ----------- |
| None |      |         |                  |       |             |
