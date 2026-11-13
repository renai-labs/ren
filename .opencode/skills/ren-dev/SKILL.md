---
name: ren-dev
description: Use when changing Ren's code: local services, which tests to run, the signoff of a push, generated code, commits and PRs. For a recorded end-to-end check use ren-e2e; for a review use ren-review.
---

# Developing Ren

## Services

- Postgres: `docker compose up -d postgres` from the repo root. Tests need only Postgres. Connection: `postgres://ren:ren@localhost:54320/ren` (`DATABASE_URL`). `docker compose up -d` also starts the drive store (`rustfs`) and `celld`; the egress needs `--profile egress`.
- API server: `bun run dev` from the repo root (port 4000, override with `PORT`). Logs go to stdout.
- Web app: `bun run dev:app` serves `http://localhost:5173/app/`. It calls the API at `VITE_REN_API_URL`, `http://localhost:4000` by default (`packages/app/README.md`).
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

Test databases are named `ren_test_clone_<uuid>`, cloned from a cached migrated template `ren_test_template_<hash>`. A clone is dropped when its test finishes, or by the next test run if its run was killed. Templates stay between runs.

## Tests

- Before adding a test, find existing coverage and name the distinct behavior it will prove. Extend that coverage where possible. Test shared user behavior through the public Ren surface; adapter tests cover translation and upstream behavior Ren relies on.
- For a recovery test, observe the fault before removing it. Observe the intended recovery mechanism before making a request that could itself trigger recovery. Use events or latches to establish ordering, and scoped finalizers to release faults and held requests.
- Keep distinct race and failure scenarios. Prune repeated happy paths and fixture-shape assertions that another test already proves.
- While you write code: `bun typecheck` in the package you change.
- One package: `cd packages/<name> && bun run test`. It runs the test files that import a changed file; `bun run test:all` runs every file. Both skip `*.slow.test.ts` files; set `REN_SLOW=1` to run them too.
- Durations: `bun run test` prints only failures. `bun test <file>` prints each test with its duration. Move a test that takes more than 5 seconds to a `*.slow.test.ts` file, as `AGENTS.md` says.
- Playwright journeys: `cd packages/e2e && bun run test`. It starts its own server on port 4010, with local brains and a stub model.
- A test that needs Docker, E2B or a credential skips without it (`test.skipIf`). A skipped test is not a passing one.
- Everything: `bun run test:all` from the repo root.
- `bun run test` runs files in isolated parallel workers and waits, or runs fewer workers, when free memory or the machine's memory budget is short. `bun run check`, `bun run lint` and `bun run typecheck` share the budget. Set `REN_TEST_WORKERS=1` for a serial run and `REN_TEST_PROFILE=1` to print setup, body and cleanup timings.
- `bun run memory` shows who holds the budget. Run another heavy command, such as a build, with `bun run memory queue -- <cmd>`.

## Signoff

Ren has no CI: `git push` signs off each commit (`CONTRIBUTING.md`, Signoff).

- Root `bun run lint` and `bun run typecheck`, and `bun run test` or `bun run test:all` in a package, record their result for the exact files they ran on. A run with extra arguments is not recorded.
- `bun run check` records nothing. Use it in the inner loop, not to sign off.
- The pre-push hook reuses the recorded lint and typecheck of the pushed files, or runs them. It never runs tests. Then it posts `signoff/lint`, `signoff/typecheck` and `signoff/test` on the commit.
- To push without running lint and typecheck twice, do not run them before the push: the hook runs them once. Run `bun run test` in each changed package on the final commit.
- `signoff/test` says `Not run for <packages>` when a package that the change affects has no recorded run.

## Commits and PRs

Before staging, read the diff and stage only the change. Commit and PR titles: `type(scope): summary` (`AGENTS.md`, Git). Fill in `.github/pull_request_template.md`.

## Generated code

After changing the protocol, server HttpApi, Better Auth or design tokens, run `bun run generate` from the repo root. Include the generated changes with their source changes.
