# @ren/executor

The executor: a small server on an environment's machine. A brain calls it to run processes and change files, so a session's tools run on the environment and not where the brain runs. It serves the `ExecutorApi` from `@ren/brain-api/executor-api`, an Effect RPC group, at `POST /v1/rpc` (NDJSON). See `specs/environments/v1.md`.

## What belongs here

- `src/executor.ts`: `Executor`, the contract for the processes and files of one environment: `Interface` and `Service`.
- `src/node-compatible.ts`: `NodeCompatible`, the implementation on `node:fs` and Effect's `ChildProcessSpawner`. Each process belongs to the brain that started it. It runs through Effect's `ChildProcessSpawner`, in a scope of its own. A running process that nobody reads or names for 30 seconds is killed with its group. Once its brain sends a `process.heartbeat`, the process is instead killed 30 seconds after the last heartbeat, even while a reader's connection still looks open: a frozen brain can hold a connection open for minutes.
- `src/server.ts`: the RPC server. A gate on the route checks the environment token before the RPC server reads the body, and the `Authentication` middleware gives the caller's brain to the handlers.
- `src/main.ts`: the program. It provides `NodeCompatible.layer` and the platform services (`BunServices.layer`), which include the `ChildProcessSpawner`.

## Notes

- Ren signs environment tokens; the executor only verifies them with `BRAIN_PUBLIC_KEYS`. It holds no secrets.
- `NodeCompatible.layer` needs a `ChildProcessSpawner`; the composition root (`main.ts`, the tests) provides it. File operations stay on `node:fs` for `lstat` and typed `readdir`.
- `hello` lists the capabilities `processes` and `files`, and the machine's shells (`shells`, by absolute path, its default first).
- A process's output is a log, like OpenCode's terminals (`pty.ts`):
  - Each `stdout` and `stderr` event carries its `offset`, the byte position at which it starts. stdout and stderr share one count.
  - `process.output` takes a `cursor` and replays the log from there, so a reader that lost its connection asks again from the last byte it got. Every reader reads on its own.
  - The executor keeps the last 2 MiB. While a reader is behind, the process waits for it, for at most 15 seconds (three missed pings). Then the executor stops waiting for that reader, the oldest output is dropped, and a reader that asks for it gets the first byte that is still kept, at a higher offset than its cursor.
  - An exited process keeps its log and its exit for 45 seconds after its last read (or its exit, if nobody reads it), longer than a brain's 30-second reconnect window. Across all brains the executor keeps at most 64 MiB of exited output and forgets the oldest first.
- `process.write` refuses stdin at once with `StdinFullError` while the process's 16-write queue is full; the brain retries. `files.read` without a range and `files.write` refuse more than 32 MiB with `FileTooLargeError`.
- A process gets the executor's own environment variables with the request's `env` on top. OpenCode sends a workspace session no base environment.
- File operations follow OpenCode's local environment: `read` and `list` follow a final symlink, `stat` does not. Errors name the path the caller gave.
- File paths are not confined to `EXECUTOR_WORKSPACE`: an absolute path, or one with `..`, reaches anywhere the executor's user can. A process can already do so, so the workspace is where relative paths start, not a boundary.
- The executor reads `BRAIN_PUBLIC_KEYS` once, at start. Restart it after Ren adds a signing key, or tokens signed with that key are refused.
- The machine needs `rg` on its `PATH`: OpenCode's grep and glob run it through the executor.

## Configuration

| Variable                  | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `EXECUTOR_ENVIRONMENT_ID` | The environment this executor serves. Tokens must name it.  |
| `EXECUTOR_WORKSPACE`      | The directory relative paths resolve against. Default: cwd. |
| `BRAIN_PUBLIC_KEYS`       | Ren's public keys, from `bun run keys` in `brain-api`.      |
| `PORT`                    | Default 4100.                                               |

## Dependencies

`@ren/schema`, `@ren/brain-api`, `effect`, `@effect/platform-bun`.

## Commands

```sh
bun run start
bun run test
bun typecheck
```
