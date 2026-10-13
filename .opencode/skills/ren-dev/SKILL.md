---
name: ren-dev
description: Use when running, debugging, or verifying Ren itself during development in this repo — starting the API server, hitting endpoints, checking the database, running one package's tests, or regenerating clients.
---

# Developing Ren

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

Test databases are named `ren_test_<uuid>` and are dropped when a test finishes. Leftovers mean a test crashed before its scope closed.

## Tests

- One package: `cd packages/<name> && bun run test`.
- End-to-end: `cd packages/e2e && bun run test`. It starts its own server on port 4010.
- Everything: `bun turbo test`.

## Generated code

After changing `packages/protocol`, run `bun run generate` from the repo root, then commit `packages/protocol/openapi.json` and `packages/client/src/**/generated/`.
