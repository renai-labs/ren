# @ren/executor

The executor: a small server on an environment's machine. A brain calls it to run processes and change files, so a session's tools run on the environment and not where the brain runs. It serves the `ExecutorApi` from `@ren/brain-api/executor-api`, an Effect RPC group, at `POST /v1/rpc` (NDJSON). See `specs/brains-and-environments.md` §6.6.

## What belongs here

- `src/executor.ts`: `Executor`, the contract for the processes and files of one environment: `Interface` and `Service`.
- `src/node-compatible.ts`: `NodeCompatible`, the implementation on `node:fs` and Effect's `ChildProcessSpawner`. Each process belongs to the brain that started it. It runs through Effect's `ChildProcessSpawner`, in a scope of its own. A running process that nobody reads or names for 30 seconds is killed with its group.
- `src/server.ts`: the RPC server. A gate on the route checks the environment token before the RPC server reads the body, and the `Authentication` middleware gives the caller's brain to the handlers.
- `src/main.ts`: the program. It provides `NodeCompatible.layer` and the platform services (`BunServices.layer`), which include the `ChildProcessSpawner`.

## Notes

- Ren signs environment tokens; the executor only verifies them with `BRAIN_PUBLIC_KEYS`. It holds no secrets.
- `NodeCompatible.layer` needs a `ChildProcessSpawner`; the composition root (`main.ts`, the tests) provides it. File operations stay on `node:fs` for `lstat` and typed `readdir`.
- `hello` lists the capabilities `processes` and `files`.
- A process's output is a log, like OpenCode's terminals (`pty.ts`):
  - Each `stdout` and `stderr` event carries its `offset`, the byte position at which it starts. stdout and stderr share one count.
  - `process.output` takes a `cursor` and replays the log from there, so a reader that lost its connection asks again from the last byte it got. Every reader reads on its own.
  - The executor keeps the last 2 MiB. While a reader is behind, the process waits for it, for at most 15 seconds (three missed pings). Then the oldest output is dropped, and a reader that asks for it gets the first byte that is still kept, at a higher offset than its cursor.
  - An exited process keeps its log and its exit until 25 newer processes of the same brain have exited.
- A process gets the executor's own environment variables with the request's `env` on top. OpenCode sends a workspace session no base environment.
- File operations follow OpenCode's local environment: `read` and `list` follow a final symlink, `stat` does not. Errors name the path the caller gave.
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
