# @ren/brain

Brain code that is the same on every host and every harness. A host (the cell in `packages/cell` today) supplies storage, alarms and a `HandAccess`; a harness adapter (the OpenCode workspace driver in `packages/cell/src/harness/opencode`) turns a `Hand` into its tools.

## What belongs here

- `src/hand-access.ts`: `HandAccess`, how a brain gets a session's `Hand.Access` (`{ directory, url, token, expiresAt, generation }`). `open` fails with `NotFound` (Ren says the session has no access) or `Unavailable` (Ren does not answer, or cannot give a hand). The cell's Host API layer is the production one; `@ren/brain/testing` has fixed and in-memory layers for tests.
- `src/hand-connections.ts`: `HandConnections`, the executor connection of each session. `release` tells Ren the session is idle and drops the connection, so the next call asks Ren again. Nothing connects before the first file or shell call. The first contact checks the executor's protocol in `hello` and makes the session's directory. An executor of another environment refuses the token, so the call fails with "token refused".
- `src/hand.ts`: `Hand`, harness-neutral tool plumbing: `spawner` runs processes through the Executor API, `Files` reads and changes files through it, and `session` gives a session's spawner and files. A harness adapter maps `Files` errors to its own; it never sees the RPC client.

## Notes

- Access refresh: a token is renewed in its last five minutes (or its last third, if it lives less than 15 minutes). Concurrent calls share one refresh. When the executor refuses a token the brain still thinks is valid, the brain gets a new access once and retries; a second refusal is "token refused", with no loop.
- Ren does not answer: the old token is used while it is valid, and Ren is asked at most once in 30 seconds. Once the token expires, calls fail with "Ren does not answer".
- Ren says no access: the connection closes at once, and the next call fails with "no access". A command that runs keeps its connection until it ends or its token expires (v1 limit).
- The hand does not answer (a transport error or a time limit): the connection closes, so the next call asks Ren again and finds a resumed or replaced hand. The failed call is not sent again.
- A new URL, generation or directory from a refresh closes the connection; a new token alone does not. A caller that holds the old connection keeps it until its scope closes.
- The spawner refuses piped commands, kills a process when its scope closes, sends `process.heartbeat` every five seconds, retries stdin that the executor refuses as full, and fails `exitCode` with the harness's signal error.
- The spawner follows a process's output from a cursor. It reconnects every second when the stream drops or goes silent for 15 seconds, and gives up when the executor no longer knows the process or has not been heard from for 30 seconds; stderr then ends with `[hand disconnected: the command did not finish]`. Lost output adds `[hand reconnected: N bytes of output were lost]`.

## Dependencies

`@ren/schema`, `@ren/hand-api`, `effect`. No harness: `@opencode/*` stays out of this package. Tests start an executor from `@ren/executor`.

## Commands

```sh
bun run test
bun typecheck
```
