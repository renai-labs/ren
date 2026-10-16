# Ren

- The default branch is `main`.
- Commits and PR titles use `type(scope): summary` with one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. The scope is optional.
- Branch names are at most three hyphenated words, with no prefix such as `feat/`.
- Follow the nearest nested `AGENTS.md` for package-specific rules.
- After changing `@ren/protocol` or the server's `HttpApi`, run `bun run generate` from the repo root. Never edit generated files (`packages/protocol/openapi.json`, `packages/client/src/**/generated/`, `packages/db/src/auth.sql.ts`). After changing Better Auth options or plugins in `@ren/server/auth`, run `bun run generate`, then `bun run db generate` in `packages/db` for the migration.

## Layering

- Runtime dependencies point from `schema` to `protocol`, `db` and `core`, and from those to `server`.
- `brain-api` is the internal contract between Ren, a session's host and an environment's executor: it depends only on `schema`; `core` calls it and `cell` serves it. `cell` depends only on `schema` and `brain-api`.
- `executor` runs on an environment's machine and serves the Executor API. It depends only on `schema` and `brain-api`.
- `brain` holds brain code that is the same on every host, such as the OpenCode `ren` driver. It depends only on `schema` and `brain-api`. `cell` may depend on `brain`.
- `client` may depend only on `schema` and `protocol`. `sdk` builds on `client`; `cli` builds on `sdk`; `app` builds on `client`, `schema`, `ui` and `util`, and uses `better-auth/client` for auth flows.
- `util` is browser-safe and imports nothing from Ren: generic helpers with a second user go there, Ren concepts go in `schema`.
- `client`, `sdk`, `cli`, `app` and `ui` never import `core`, `db`, `server` or `brain-api`. oxlint and `packages/client/test/import-boundaries.test.ts` enforce this.
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
- Effect tests use `const it = testEffect(layer)` from `packages/core/test/lib/effect.ts`, then `it.effect` / `it.live`. The harness fails any test that makes a non-loopback network request.

## Checks

- Run `bun run check` from the repo root before pushing. The pre-push hook runs it too.
- Run `bun typecheck` from a package directory to typecheck one package. Never run `tsc` directly.
- Lint rules live in `oxlint.config.ts`, the Ren Oxlint plugin (`script/oxlint/ren/`) and `script/ast-grep/`. Oxlint loads its config and plugin through Node (see `.node-version`).

## Lint Standard

- Optional properties are `key?: T`. Write `key?: T | undefined` only when `undefined` is a meaningful value callers pass through. Omit the key with a conditional spread only where a third-party type forbids `undefined`.
- Every lint rule applies to every file. Overrides in `oxlint.config.ts` are by file type only; the architecture block at the end is the one package-scoped exception.
- Rules turned off on purpose:
  - `oxc/no-barrel-file`: every module starts with `export * as X from "./x.js"`.
  - `unicorn/throw-new-error`: it misreads Effect's `Schema.TaggedError<X>()(...)`.
  - `typescript/only-throw-error`: TanStack Router throws `redirect()`.
  - `unicorn/prefer-global-this`: `globalThis.x` would bypass the `window.x` restrictions.
  - `eslint/no-useless-return`: it conflicts with `noImplicitReturns`.
  - `eslint/require-yield`: `Effect.fn` takes generators that may not yield.
  - `noPropertyAccessFromIndexSignature`: `noUncheckedIndexedAccess` already types index access as possibly `undefined`.
- Lint rules have no unit tests. The codebase is their test, so a new rule lands with fixes for everything it reports.

## Vendored Repositories

This project vendors external repositories under @repos/.

- Use them as read-only reference material. Prefer their patterns over guesses or web search.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/. Import from normal package dependencies.
- When writing Effect code, inspect @repos/effect for idiomatic usage, tests, module structure and API design. Treat it as the source of truth for Effect patterns.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
