# @ren/brain

Brain code that is the same on every host and harness. Today: how a brain reaches its environment (`src/environment/`), through the executor's `EnvironmentApi`.

A host (the cell in `packages/cell` today) supplies storage, alarms and an `EnvironmentAccess`; a harness adapter (the OpenCode workspace driver in `packages/cell/src/harness/opencode`) turns an `EnvironmentSession` into its tools.

## What belongs here

- `src/environment/access.ts`: `EnvironmentAccess`, how a brain gets a session's `Environment.Access` (`{ directory, url, token, expiresAt, generation }`). `open` fails with `NotFound` (Ren says the session has no access) or `Unavailable` (Ren does not answer, or cannot give an environment). The cell's Ren Host API layer is the production one; `@ren/brain/testing` has fixed and in-memory layers for tests.
- `src/environment/connections.ts`: `EnvironmentConnections`, the executor connection of each session. `release` tells Ren the session is idle and drops the connection, so the next call asks Ren again. Nothing connects before the first file or shell call. The first contact checks the executor's protocol in `hello` and makes the session's directory. An executor of another environment refuses the token, so the call fails with "token refused".
- `src/environment/session.ts`: `EnvironmentSession`, a session's processes and files on its environment, with no harness in them: `Files` reads and changes files through the Environment API, and `make` gives a session's spawner and files. A harness adapter maps `Files` errors to its own; it never sees the RPC client. `EnvironmentConnections.failureOf` names an environment failure inside any error, for a harness to show.
- `src/environment/session/spawner.ts`: `EnvironmentSpawner`, a `ChildProcessSpawner` whose processes run on the environment through the Environment API.
- `src/opencode-sync.ts`: `OpenCodeSync`, the sync step of `specs/session-sync-plan.md` §9.1 and §9.2. It reads the host database through a `Reader` the host gives it, and uploads each session that changed to Ren's `SyncApi`. `exclusive` runs an effect, such as a restore, while no step runs.
- `src/sqlite-reader.ts`: the `Reader` of a sandbox host: a read-only `bun:sqlite` connection that does each read in one read transaction. The cell bundle does not import it.

## Notes

- Access refresh: a token is renewed in its last five minutes (or its last third, if it lives less than 15 minutes). Concurrent calls share one refresh. When the executor refuses a token the brain still thinks is valid, the brain gets a new access once and retries; a second refusal is "token refused", with no loop.
- Ren does not answer: the old token is used while it is valid, and Ren is asked at most once in 30 seconds. Once the token expires, calls fail with "Ren does not answer".
- Ren says no access: the connection closes at once, and the next call fails with "no access". A command that runs keeps its connection until it ends or its token expires (v1 limit).
- The environment does not answer (a transport error or a time limit): the connection closes, so the next call asks Ren again and finds a resumed or replaced environment. The failed call is not sent again.
- A new URL, generation or directory from a refresh closes the connection; a new token alone does not. A caller that holds the old connection keeps it until its scope closes.
- The spawner refuses piped commands, kills a process when its scope closes, sends `process.heartbeat` every five seconds, retries stdin that the executor refuses as full, and fails `exitCode` with the harness's signal error.
- The spawner follows a process's output from a cursor. It reconnects every second when the stream drops or goes silent for 15 seconds, and gives up when the executor no longer knows the process or has not been heard from for 30 seconds; stderr then ends with `[environment disconnected: the command did not finish]`. Lost output adds `[environment reconnected: N bytes of output were lost]`.
- A sync step compares each local session's checkpoint `E` and `time_suspended` with Ren's copy. A pass sends every message in batches of at most 500 rows or 1 MiB, then commits the session row with `E` and the sent IDs. A row whose batch alone is larger than the `SyncApi` body limit stops its pass with no commit, logs the row and increases `opencode_sync_oversized_rows`.
- The 5-minute limit on passes applies only while the session is busy locally and Ren already shows it busy, so a claim and a release reach Ren at the next step. The time of the last pass is kept in memory, so the first step after a restart does a pass at once.
- A failed pass logs a warning and makes the step not `drained`; the next step starts a new upload. The step itself fails only when it cannot read the tables, the tables lack a column that sync reads, or Ren does not return the checkpoints.
- Ren's refusal of a root session that it does not have is kept in memory, with the refusal of that root's children. A refused child whose parent is not refused is sent again by the next step.
- The host replaces a raw NUL in a text column with U+FFFD before upload, because Postgres `text` refuses it.

## Dependencies

`@ren/schema`, `@ren/environment-api`, `effect`. No harness: `@opencode/*` stays out of this package. Tests start an executor from `@ren/executor`.

## Commands

```sh
bun run test
bun typecheck
```
