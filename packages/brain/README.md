# @ren/brain

Brain code that is the same on every host. A host (the cell in `packages/cell` today) supplies storage, alarms and an OpenCode opener; this package supplies the rest. See `specs/brains-and-environments.md` §7.4.

## What belongs here

- `src/environment-access.ts`: `EnvironmentAccess`, how a brain gets an environment's `Access` and hears that it changed. `layerFixed` gives fixed accesses, for tests and development. `layerMemory` gives accesses that `Memory` changes, for tests.
- `src/environments.ts`: `Environments`, the executors a brain uses. It opens each once, checks `hello`, and keeps the connection. When a token has less than five minutes left, the next call opens the environment again for a new token, as OpenCode does for OAuth credentials. Concurrent calls share that one refresh. A refresh that fails keeps the old token. A refresh that names a new URL or generation keeps the old token on the old connection and drops it, so the next call connects to the new machine even if no change is reported. When `EnvironmentAccess` reports a change, a new token replaces the held one; a new URL, a new generation or a removed access drops the connection, so the next call connects again. A caller that holds the old connection keeps it until its scope closes. When the executor refuses a token the brain still thinks is valid, for example because the clocks disagree, the brain opens the environment again and retries once.
- `src/environment-bindings.ts`: `EnvironmentBindings`, the environment each session's tools run on. A binding is the session's directory and an environment location, or no location. `set` checks that the directory exists on the environment before it stores the binding in a `KeyValueStore` the host gives it, keyed by session ID.
- `src/opencode-workspace-driver.ts`: the OpenCode `ren` workspace driver. Its spawner runs processes through the Executor API, and its file overrides call the file routes. `replacements` gives the two OpenCode replacements a host adds: the driver, and `rg` from the environment's `PATH`.

## Notes

- In a brain with environments, every session has an OpenCode workspace with the `ren` provider. The workspace ID is `wrk_` plus the session ID's suffix, so no table maps them.
- OpenCode keeps one driver connection for each workspace. The `ren` driver's connection holds no executor: each file call and each spawn reads the session's binding and connects then. Thus a new binding or a replaced machine reaches the next tool call, and OpenCode's cache needs no change. A process keeps the connection it started on until it ends.
- Paths under the session's directory map onto the binding's directory: a process's working directory and each file path. Command text and arguments go to the environment as they are, so a shell command that names the session's directory runs against that path on the environment. The cell's `ren.environment` instruction tells the model the environment's directory.
- The spawner refuses piped commands, kills a process when its scope closes, and fails `exitCode` with OpenCode's `KilledBySignal` when a signal ended the process.
- OpenCode picks a shell from the brain's host. When it asks for a POSIX shell with `-c` that the machine does not have, the spawner runs the script with the machine's default shell from `hello.shells`.
- While a process runs, the spawner sends `process.heartbeat` every five seconds, so the executor kills it 30 seconds after the brain stops, even if the brain froze with its connection open. An executor without heartbeats rejects them, and the spawner ignores that.
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
