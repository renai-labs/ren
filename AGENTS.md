# Ren

- The default branch is `main`.
- Commits and PR titles use `type(scope): summary` with one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. The scope is optional.
- Branch names are at most three hyphenated words, with no prefix such as `feat/`.
- Follow the nearest nested `AGENTS.md` for package-specific rules.
- After changing `@ren/protocol` or the server's `HttpApi`, run `bun run generate` from the repo root. Never edit generated files (`packages/protocol/openapi.json`, `packages/client/src/**/generated/`, `packages/db/src/auth.sql.ts`). After changing Better Auth options or plugins in `@ren/server/auth`, run `bun run generate`, then `bun run db generate` in `packages/db` for the migration.

## Layering

- Runtime dependencies point from `schema` to `protocol`, `db` and `core`, and from those to `server`.
- `client` may depend only on `schema` and `protocol`. `sdk` builds on `client`; `cli` builds on `sdk`; `app` builds on `client` and `ui`, and uses `better-auth/client` for auth flows.
- `client`, `sdk`, `cli`, `app` and `ui` never import `core`, `db` or `server`. oxlint and `packages/client/test/import-boundaries.test.ts` enforce this.
- `httpapi-codegen` stays independent of every Ren package.

## Style

- Keep logic in one function unless it is composable or reusable.
- Validate unknown input once at the boundary; trust the resulting types afterwards.
- Do not extract single-use helpers.
- Avoid `try`/`catch` where possible.
- Avoid `any`, non-null assertions and unchecked casts.
- Prefer Bun APIs, such as `Bun.file()`, when they fit.
- Rely on type inference; add explicit annotations only for exports or when inference fails.
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops. Use type guards on `filter` to keep inference downstream.
- Inline single-use variables.
- Avoid destructuring; use dot access.
- Prefer `const`. Prefer early returns over `else`.
- Do not add comments unless the code cannot explain a non-obvious constraint itself.

### Imports

- Never alias imports.
- Never use star imports (`import * as X`). Self-namespace exports (`export * as X from "./x.js"`) are the module pattern, not star imports.
- Do not use type-position `import("...")`.
- Import a module's namespace by name: `import { Health } from "@ren/core/health"`.
- Relative imports use `.js` extensions.

### Modules

- Each module starts with a self-namespace export, then its imports:

  ```ts
  export * as Health from "./health.js"

  import { Context, Effect, Layer } from "effect"
  ```

- Package barrels (`src/index.ts`) re-export namespaces only.

## Effect

- Before writing Effect code, read `repos/effect/LLMS.md` and search `repos/effect` for exact APIs. Do not answer from memory.
- Use `Effect.gen(function* () { ... })` for multi-step work and `Effect.fn("Name")` for named service methods.
- Define services as `class Service extends Context.Service<Service, Interface>()("@ren/<package>/<Name>") {}` with an explicit `layer`.
- Bind services to named variables before calling methods. Do not nest service yields such as `(yield* X.Service).method()`.
- Model domain errors with tagged schema errors. Die with `new Error(...)`, never a string.
- Prefer `Schema.UnknownFromJsonString` (or a schema decoder) over `JSON.parse`.
- Pure helpers do not return `Effect`.
- Keep layer composition explicit.
- Keep HTTP handlers thin: decode input, call services, map errors.

## Drizzle

- Tables live in `packages/db/src/**/*.sql.ts`.
- Use snake_case object keys so column names never need to be repeated as strings.

## Testing

- Avoid mocks. Test the actual implementation; do not duplicate logic into tests.
- Tests cannot run from the repo root. Run `bun run test` from the package directory.
- Database tests run against real Postgres (`docker compose up -d`) using `@ren/db/testing`, which creates and drops an isolated database per layer.
- Effect tests use `testEffect(layer)` / `it.effect` / `it.live` from `packages/core/test/lib/effect.ts`. The harness fails any test that makes a non-loopback network request.

## Checks

- Run `bun run check` from the repo root before pushing. The pre-push hook runs it too.
- Run `bun typecheck` from a package directory to typecheck one package. Never run `tsc` directly.
- Lint rules live in `oxlint.config.ts`, the Ren Oxlint plugin (`script/oxlint/ren/`) and `script/ast-grep/`. Oxlint loads its config and plugin through Node (see `.node-version`). Add a test for every new rule, then run `bun run test:lint-rules`.

## Vendored Repositories

This project vendors external repositories under @repos/.

- Use them as read-only reference material. Prefer their patterns over guesses or web search.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/. Import from normal package dependencies.
- When writing Effect code, inspect @repos/effect for idiomatic usage, tests, module structure and API design. Treat it as the source of truth for Effect patterns.
