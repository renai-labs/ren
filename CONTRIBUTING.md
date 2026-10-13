# Contributing to Ren

## Setup

Requires Bun 1.4.2 and Docker.

```sh
bun install
cp .env.example .env
docker compose up -d
```

## Development

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `bun run dev`      | Start the API server on port 4000 with watch              |
| `bun run dev:app`  | Start the web app (proxies the API to the server)         |
| `bun run dev:site` | Start the docs site                                       |
| `bun run generate` | Regenerate `openapi.json` and the clients                 |
| `bun run format`   | Format the repo with Prettier                             |
| `bun run check`    | Lint (oxlint, ast-grep and knip) and typecheck everything |

The web app and the API share one origin. In development Vite proxies `/auth`, `/openapi.json` and every API resource root in `packages/protocol/openapi.json` (`/spaces`, `/me`, …) to `REN_API_URL` (default `http://localhost:4000`). A request that accepts `text/html` on a resource root is served the app instead, so reloading `/spaces` still loads the page.

## Verification

Run tests and typechecks from the affected package, not the repo root:

```sh
cd packages/core
bun run test
bun typecheck
```

Database tests need Postgres from `docker compose up -d`. End-to-end tests live in `packages/e2e` and start their own server.

Follow the [style guide](./AGENTS.md) and any `AGENTS.md` next to the code you change. After changing the API contract in `packages/protocol`, run `bun run generate` and commit the regenerated files. Never edit generated files by hand.

## Pull requests

- Title: `type(scope): summary` with one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
- Fill in the PR template: what changed, why, and how you verified it.
- Keep PRs focused. Do not include unrelated changes.
- Include screenshots or recordings for UI changes.
- CI runs `bun run check`, affected tests, generated-file checks and end-to-end tests.
