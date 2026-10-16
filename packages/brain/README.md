# @ren/brain

Brain code that is the same on every host. A host (the cell in `packages/cell` today) supplies storage, alarms and an OpenCode opener; this package supplies the rest. See `specs/brains-and-environments.md` §7.4.

## What belongs here

- `src/environment-access.ts`: `EnvironmentAccess`, how a brain gets an environment's `Access`. `layerFixed` gives fixed accesses, for tests and development.
- `src/environments.ts`: `Environments`, the executors a brain uses. It opens each once, checks `hello`, and keeps the connection. When a token has less than five minutes left, the next call opens the environment again for a new token, as OpenCode does for OAuth credentials. Concurrent calls share that one refresh. A refresh that fails keeps the old token.
- `src/opencode-workspace-driver.ts`: the OpenCode `ren` workspace driver. Its spawner runs processes through the Executor API, and its file overrides call the file routes. `replacements` gives the two OpenCode replacements a host adds: the driver, and `rg` from the environment's `PATH`.

## Notes

- A session uses an environment when its OpenCode workspace has the `ren` provider. The workspace ID is `wrk_` plus the environment ID's suffix, so no table maps them.
- The spawner refuses piped commands, kills a process when its scope closes, and fails `exitCode` with OpenCode's `KilledBySignal` when a signal ended the process.
- The spawner follows a process's output from a cursor:
  - **Reconnects.** When the stream drops, or goes silent for 15 seconds (three missed pings), it asks again from the last byte it received, every second, like OpenCode's event stream.
  - **Gives up** when the executor no longer knows the process, or has not been heard from for 30 seconds, the time after which the executor kills a process nobody reads. stderr then ends with `[environment disconnected: the command did not finish]`.
  - **Notes lost output.** If the executor dropped output the spawner had not read, stderr gets `[environment reconnected: N bytes of output were lost]`.
- OpenCode's formatters, git snapshots and `AGENTS.md` discovery still use the host, not the environment.

## Dependencies

`@ren/schema`, `@ren/brain-api`, `@opencode/core`, `@opencode/schema`, `@opencode/util`, `effect`. Tests start an executor from `@ren/executor`.

## Commands

```sh
bun run test
bun typecheck
```
