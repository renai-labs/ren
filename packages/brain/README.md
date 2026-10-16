# @ren/brain

Brain code that is the same on every host. A host (the cell in `packages/cell` today) supplies storage, alarms and an OpenCode opener; this package supplies the rest. See `specs/brains-and-environments.md` §7.4.

## What belongs here

- `src/environment-access.ts`: `EnvironmentAccess`, how a brain gets an environment's `Access`. `layerFixed` gives fixed accesses, for tests and development.
- `src/environments.ts`: `Environments`, the executors a brain uses. It opens each once, checks `hello`, and keeps the connection.
- `src/opencode-workspace-driver.ts`: the OpenCode `ren` workspace driver. Its spawner runs processes through the Executor API, and its file overrides call the file routes. `replacements` gives the two OpenCode replacements a host adds: the driver, and `rg` from the environment's `PATH`.

## Notes

- A session uses an environment when its OpenCode workspace has the `ren` provider. The workspace ID is `wrk_` plus the environment ID's suffix, so no table maps them.
- The spawner refuses piped commands, kills a process when its scope closes, and fails `exitCode` with OpenCode's `KilledBySignal` when a signal ended the process.
- OpenCode's formatters, git snapshots and `AGENTS.md` discovery still use the host, not the environment.

## Dependencies

`@ren/schema`, `@ren/brain-api`, `@opencode/core`, `@opencode/schema`, `@opencode/util`, `effect`. Tests start an executor from `@ren/executor`.

## Commands

```sh
bun run test
bun typecheck
```
