# Contributing to Ren

Ren does not accept outside contributions. Only collaborators can open pull requests and merge to `main`. Everyone else is welcome to [open an issue](https://github.com/renai-labs/ren/issues/new/choose) for bugs and feature requests.

## Setup

Requires Bun 1.4.2 and Docker.

```sh
bun install
cp .env.example .env
docker compose up -d
```

## Development

| Command            | What it does                                      |
| ------------------ | ------------------------------------------------- |
| `bun run dev`      | Start the API server on port 4000 with watch      |
| `bun run dev:app`  | Start the web app (proxies the API to the server) |
| `bun run dev:site` | Start the docs site                               |
| `bun run generate` | Regenerate `openapi.json` and the clients         |
| `bun run format`   | Format the repo with oxfmt                        |
| `bun run check`    | Lint, check formatting and typecheck everything   |

The web app and the API run on separate origins. The app is served under `/app/` (`http://localhost:5173/app/` in development, `https://useren.ai/app/` in production) and calls the API directly at `VITE_REN_API_URL` (default `http://localhost:4000` in development, `https://api.useren.ai` in production) with credentials. The server allows the origins in `TRUSTED_ORIGINS` (CORS and Better Auth) and builds email links from `APP_URL`, which includes `/app`.

## Verification

Run tests and typechecks from the affected package, not the repo root:

```sh
cd packages/core
bun run test
bun typecheck
```

Database tests need Postgres from `docker compose up -d`. End-to-end tests live in `packages/e2e` and start their own server.

### Signoff

Pull requests have no CI. `git push` signs off each commit it sends instead, from your machine:

- `bun run lint`, `bun run typecheck` and each package's `bun run test` record their result for the exact files they ran on, in `.git/ren-signoff`. A run with extra arguments, such as one test file, is not recorded.
- The pre-push hook reuses the runs that match the pushed commit's files, and runs lint and typecheck when they are missing. A lint or typecheck failure blocks the push. It never runs tests: the signoff shows the latest test run of each package affected since `main`, or that it did not run on these files. When the working directory differs from the pushed commit, the hook runs `bun run check` as before and reuses only earlier matching runs.
- When GitHub accepts the push, the `reference-transaction` hook posts the `signoff/lint`, `signoff/typecheck` and `signoff/test` statuses on the commit with `gh`. Nothing blocks a merge, and a commit pushed without the hooks has no statuses.
- `gh` must be logged in with access to commit statuses, and the push must go to a named remote such as `origin`.

Follow the [style guide](./AGENTS.md) and any `AGENTS.md` next to the code you change. After changing the API contract in `packages/protocol`, run `bun run generate` and commit the regenerated files. Never edit generated files by hand.

## Pull requests

- Title: `type(scope): summary` with one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
- Fill in the PR template: what changed, why, and how you verified it.
- Keep PRs focused. Do not include unrelated changes.
- Include screenshots or recordings for UI changes.
- The `signoff/*` statuses show what `git push` checked. Generated-file checks and end-to-end tests are not part of them.
