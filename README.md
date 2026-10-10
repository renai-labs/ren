# Ren

## Repo map

| Path                       | What goes here                                                                   |
| -------------------------- | -------------------------------------------------------------------------------- |
| `packages/schema`          | Effect Schema contracts shared by every layer: branded IDs, entities, payloads   |
| `packages/protocol`        | `HttpApi` endpoint definitions and API errors; owns the generated `openapi.json` |
| `packages/db`              | Drizzle tables, migrations, Postgres layers, isolated test databases             |
| `packages/core`            | Domain services and layers. No HTTP                                              |
| `packages/server`          | HTTP handlers, middleware and runtime composition. The API process               |
| `packages/httpapi-codegen` | Build-time generator from `HttpApi` to typed clients                             |
| `packages/client`          | Generated Promise and Effect clients                                             |
| `packages/sdk`             | Public SDK (`@renai-labs/sdk`) built on the client                               |
| `packages/cli`             | The `ren` command (`@renai-labs/cli`)                                            |
| `packages/util`            | Shared Effect and platform helpers                                               |
| `packages/ui`              | React design system                                                              |
| `packages/app`             | Product web app (Vite + React)                                                   |
| `packages/site`            | Docs and marketing site (Astro + Starlight)                                      |
| `packages/e2e`             | End-to-end tests across server, client, CLI and app (Playwright)                 |
| `repos/`                   | Vendored source for reference only (git subtrees). Never imported                |
| `script/`                  | Repo scripts: code generation, formatting, isolated test runner, ast-grep rules  |
| `specs/`                   | Specifications for behavior that spans modules                                   |
| `.opencode/`               | Agent commands and skills                                                        |
| `.github/`                 | CI workflows, PR and issue templates                                             |

## Quick start

Requires Bun 1.4.2 and Docker.

```sh
bun install
docker compose up -d
bun run check
bun run dev
```

`bun run dev` starts the API on `http://localhost:4000`. Try `curl localhost:4000/api/health`.

Run tests from a package directory:

```sh
cd packages/core
bun run test
```

## Further reading

- [AGENTS.md](./AGENTS.md): layering, style and Effect rules
- [CONTRIBUTING.md](./CONTRIBUTING.md): workflow, commands and PR conventions
- [specs/](./specs): specifications
- [repos/README.md](./repos/README.md): vendored repositories
- [TODO.md](./TODO.md): deferred work
