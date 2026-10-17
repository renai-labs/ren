# @ren/e2e

End-to-end tests across server, client, CLI and app (Playwright), and the chaos cases that need several real components at once (Bun).

## What belongs here

- Flows that cross package boundaries: API through the generated client, CLI against a live server, and app flows in a browser.
- Chaos cases that need a fault on a real link between components, a real platform (Docker, Wrangler, E2B, Cloudflare), a live model or LiteLLM, or a seeded sequence of faults across components.

## What does not

- Unit and focused regression tests. Those live in each package's `test/` directory, beside the code they protect. The executor, brain, cell and core suites own executor behaviour, environment connections, turns, alarms, leases, crash recovery and model refresh, including the cell on real workerd.

## Dependencies

Any package, test-only. Chaos reuses `@ren/cell/testing` (`Wrangler`, `TestCell`, `Shared`, `TestToken`) and `@ren/executor/testing` (`Machine` keys), and runs the cell Worker in `packages/cell/test/lib/environment-worker.ts` with `CHAOS_CONTROL_URL`, so the cell reads environment access from the chaos control server.

## Two runners

| Runner     | Files                   | Runtime | Command               |
| ---------- | ----------------------- | ------- | --------------------- |
| Playwright | `tests/**/*.spec.ts`    | Node    | `bun run test`        |
| Bun        | `chaos/cases/*.test.ts` | Bun     | `bun run chaos`, etc. |

Playwright's `testDir` is `./tests`, and `bunfig.toml` sets the Bun test root to `./chaos/cases`, so neither runner collects the other's files. Playwright specs run under Node: use `node:` APIs instead of `Bun.*` in `tests/`.

## Playwright stack

`script/serve.ts` creates an isolated database, migrates it and starts three processes, then drops the database on shutdown:

- The server on `E2E_PORT` (default 4010). API and CLI specs call it directly through `serverURL`.
- The app on `E2E_APP_PORT` (default 4011), served under `/app/` and calling the server cross-origin with credentials. Playwright's `baseURL` is the app origin, so specs navigate to `/app/...`; `appURL` in `tests/lib/servers.ts` includes the `/app` base.
- A mailbox on `E2E_MAILBOX_PORT` (default 4012). `GET /?to=<email>` returns the last email the server logged for that address, so specs read codes and links from real emails.

## Chaos harness

```
chaos/
  cases/         plain bun:test files, named by behaviour
  lib/
    stack.ts     one local lane: control server, model provider, test issuer, Wrangler cell, executors
    control.ts   GET /environments/:id and the /environments/changes long poll the cell reads
    faults/      the fault proxy that sits on every link
    adapters/    executor (local process, Docker), E2B, Cloudflare
    drivers/     Executor API client, Brain API and OpenCode session driver over TestCell
    provider/    scripted model provider, test issuer, live model selection, LiteLLM key admin
    platform.ts  one skip reason per platform or credential, computed once
    preload.ts   refuses non-loopback requests outside the selected mode; tears down on SIGINT
  infra/         the executor image and the E2B template
script/chaos/    template.ts builds the E2B template
.runs/           ignored executor logs, one directory per run
```

`Stack.start` composes one local lane. Each link (core and user to brain, brain to hand, brain to core, brain to provider) goes through its own fault proxy, so a case can refuse a request before delivery, drop the reply after the upstream committed it, answer with a status, hold it, cut the reply after some bytes or lines, partition the link or cut every open connection. `cases/fault-proxy.test.ts` checks where each fault lands.

The scripted model provider answers each call of a turn with the next step of its script: text, a tool call, a status with headers, a cut stream, a malformed frame or malformed tool arguments. `StubModel` from `@ren/cell/testing` gives one behaviour per script, and the provider and stream-fault cases need a different answer for each call of one turn.

A case that needs a platform or a credential uses `describe.skipIf` or `test.skipIf` with a reason from `lib/platform.ts`. The preload prints each unmet reason once.

## Commands

```sh
bun run test               # Playwright; needs `docker compose up -d`
bun run chaos              # the local lane: Wrangler, Docker; live and deployed cases skip
bun run chaos:live         # live-model and litellm cases; needs CHAOS_LIVE_MODEL
bun run chaos:deployed     # e2b and soak cases; needs E2B and Cloudflare credentials
bun run chaos:template     # bundle the executor and build the E2B template
bun typecheck
```

| Variable                                                | Use                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CHAOS_SEED`, `CHAOS_SEQUENCES`, `CHAOS_ACTIONS`        | The first seed of the seeded sequences (default 20261016), how many sequences run (3) and how many actions each has (20). |
| `CHAOS_SLOW`                                            | Runs the cases that wait out OpenCode's retry schedule.                                                                   |
| `CHAOS_SOAK_MS`                                         | How long the soak cycles run.                                                                                             |
| `CHAOS_LIVE_MODEL`, `CHAOS_LIVE_MODEL_ALT`              | One or two small models from the effective OpenCode config, such as `ren/anthropic/claude-haiku-5-5`.                     |
| `CHAOS_LIVE_BASE_URL`                                   | The bridge host the test process may call in live mode.                                                                   |
| `CHAOS_LITELLM_ADMIN_URL`, `CHAOS_LITELLM_ADMIN_KEY`    | An isolated LiteLLM key-management credential.                                                                            |
| `E2B_API_KEY`, `CHAOS_E2B_TEMPLATE`, `CHAOS_E2B_DOMAIN` | Deployed hands.                                                                                                           |
| `CHAOS_CLOUDFLARE_URL`                                  | The deployed Worker URL, with `{name}` for the per-run Worker name.                                                       |
