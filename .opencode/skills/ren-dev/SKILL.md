---
name: ren-dev
description: Use when reviewing, running, debugging, or verifying Ren, preparing commits and PRs, selecting tests, or regenerating clients.
---

# Developing Ren

## Scope and handoffs

- Keep the current scope, deferred work, review checkpoint, commit permission and target branch in handoffs and compaction summaries. Apply the user's latest instructions.
- For a review-only task, report findings. Tool feedback does not grant permission to edit files.
- Before staging, inspect the diff and select only the requested changes. Keep unrelated work and deferred features out of the commit.
- Report what changed, what remains and any blocker when a step finishes or progress stalls. Distinguish static review, checks that passed and checks still running.

## Services

- Postgres: `docker compose up -d` from the repo root. Connection: `postgres://ren:ren@localhost:54320/ren` (`DATABASE_URL`).
- API server: `bun run dev` from the repo root (port 4000, override with `PORT`). Logs go to stdout.
- Web app: `bun run dev:app`. Vite proxies the API routes (`/auth`, `/spaces`, `/me`, …) to the API server; browser page loads (`Accept: text/html`) still get the SPA.
- Docs site: `bun run dev:site`.

## Checking the server

```sh
curl localhost:4000/health
curl localhost:4000/openapi.json
REN_URL=http://localhost:4000 bun run --cwd packages/cli dev health
```

## Database

```sh
docker compose exec postgres psql -U ren
```

Test databases are named `ren_test_<uuid>` and are dropped when a test finishes. Leftover clones mean a test crashed before its scope closed. Databases named `ren_test_template_<hash>` are reusable migration templates; they remain between runs and reject connections. Set `REN_TEST_PROFILE=1` when running tests to report database phases, core Effect setup/body/cleanup, and runner timing. These measurements are nested; do not add them together. Use Turbo's `--force` when profiling through Turbo to avoid replaying cached output.

## Tests

- Before adding a test, find existing coverage and name the distinct behavior it will prove. Extend that coverage where possible. Test shared user behavior through the public Ren surface; adapter tests cover translation and upstream behavior Ren relies on.
- For a recovery test, observe the fault before removing it. Observe the intended recovery mechanism before making a request that could itself trigger recovery. Use events or latches to establish ordering, and scoped finalizers to release faults and held requests.
- Keep distinct race and failure scenarios. Prune repeated happy paths and fixture-shape assertions that another test already proves.
- One package: `cd packages/<name> && bun run test`. It skips `*.slow.test.ts` files; set `REN_SLOW=1` to run them too.
- Durations: `bun run test` prints only failures. `bun test <file>` prints each test with its duration. Move a test that takes more than 5 seconds to a `*.slow.test.ts` file, as `AGENTS.md` says.
- End-to-end: `cd packages/e2e && bun run test`. It starts its own server on port 4010.
- Everything: `bun turbo test`.
- Runs through `script/test.ts` use Bun's isolated process workers (default two, or one on a single-CPU host). Set `REN_TEST_WORKERS=1` for a serial run. Every file gets a fresh HOME and temporary directory before package preloads. Bun records file durations in the package's ignored `.cache/test-timings.json` and uses them to start slow files first. Native `--changed` and `--shard=1/3` arguments pass through to Bun.
- The runner reserves a machine-wide test memory budget before starting. `REN_TEST_MEMORY_MIB` sets the reservation per worker (default 1536); `REN_TEST_BUDGET_MIB` sets the total (default half the host's memory, capped at one reservation per CPU). An oversized run can proceed alone. Reservations from dead owners are removed on the next attempt. Profiling reports admission time separately as `waitMs`. Bun's `--no-orphans` removes descendant processes when their runner exits.
- Run homes include their owner's PID under the test budget directory. The next admitted run removes homes whose owners have exited, including runs killed before normal cleanup. Live owners' directories are preserved.

## Generated code

After changing the protocol, server HttpApi, Better Auth or design tokens, run `bun run generate` from the repo root. Include the generated changes with their source changes.
