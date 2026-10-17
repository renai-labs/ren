# Ren

This file has only the rules for all of Ren. Load the other instructions when your task needs them.

| Task                                    | Instructions                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Change a package                        | `packages/<name>/AGENTS.md`. Read a file in the package to load it.          |
| Write Effect code                       | The `effect` skill.                                                          |
| Write React or interface code           | The `react` and `interface` skills.                                          |
| Run, debug or verify Ren                | The `ren-dev` skill.                                                         |
| Change design tokens                    | The `sync-with-paper` skill.                                                 |
| Change lint rules or `oxlint.config.ts` | `script/AGENTS.md`.                                                          |
| Change Turborepo config                 | `docs/` in the installed `turbo` package. Its behaviour differs from memory. |
| Write a spec                            | `specs/README.md`.                                                           |

## Git

- The default branch is `main`.
- Commits and PR titles use `type(scope): summary` with one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. The scope is optional.
- Branch names are at most three hyphenated words, with no prefix such as `feat/`.

## Layering

- Runtime dependencies point from `schema` to `protocol`, `db` and `core`, and from those to `server`.
- `brain-api` is the internal contract between Ren, a session's host and an environment's executor: it depends only on `schema`; `core` calls it and `cell` serves it. `cell` depends only on `schema`, `brain-api` and `brain`.
- `executor` runs on an environment's machine and serves the Executor API. It depends only on `schema` and `brain-api`.
- `brain` holds brain code that is the same on every host, such as the OpenCode `ren` driver. It depends only on `schema` and `brain-api`.
- `client` may depend only on `schema` and `protocol`. `sdk` builds on `client`; `cli` builds on `sdk`; `app` builds on `client`, `schema`, `ui` and `util`, and uses `better-auth/client` for auth flows.
- `util` is browser-safe and imports nothing from Ren: generic helpers with a second user go there, Ren concepts go in `schema`.
- `client`, `sdk`, `cli`, `app` and `ui` never import `core`, `db`, `server` or `brain-api`.
- `httpapi-codegen` stays independent of every Ren package.
- `repos/` holds read-only copies of external repositories for reference. Do not edit or import them.

## Style

Lint enforces most style rules. Run `bun run check` and follow each message. These rules need judgment:

- Keep logic in one function unless it is composable or reusable. Do not extract single-use helpers. Inline single-use variables.
- Validate unknown input once at the boundary; trust the resulting types afterwards.
- Avoid `try`/`catch` and unchecked casts.
- Prefer Bun APIs, such as `Bun.file()`, when they fit.
- Rely on type inference; add explicit annotations only for exports or when inference fails.
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops. Use type guards on `filter` to keep inference downstream.
- Avoid destructuring; use dot access.
- Optional properties are `key?: T`. Write `key?: T | undefined` only when callers pass `undefined` on purpose.
- Each module starts with a self-namespace export (`export * as Health from "./health.js"`), then its imports. Package barrels (`src/index.ts`) re-export namespaces only.
- Import a module's namespace by name: `import { Health } from "@ren/core/health"`. Relative imports use `.js` extensions. Do not use type-position `import("...")`.
- Never edit generated files. After a change to `@ren/protocol`, the server's `HttpApi`, Better Auth or design tokens, run `bun run generate` from the repo root.

## Testing

- Write the test first. Make sure that it fails before the change and passes after it.
- Test the hot paths first. Do not test an edge case that no user or caller can cause.
- Test each behaviour one time, at the lowest level that can show it, in the package that owns it. Before you add a test, find the tests of that behaviour and add to them.
- Write a unit test only for a rule that is not clear from the code, a race or a bug. Do not test a simple fact, such as a constant, a config value or a library that operates as its documentation tells.
- Do not write placeholder tests, or tests that compare lists of keys, coverage matrices or specification text.
- Do not use mocks or real-time waits. Use real dependencies, and use `TestClock`, a latch or an event that the test can see.
- For a bug that has no fix, write a `test.todo` with the issue ID in its name. After the fix, run `bun test --todo` and change each `test.todo` that passes to `test`.
- Run `bun run test` from the package directory. Tests cannot run from the repo root.

## Checks

- Run `bun run check` from the repo root before pushing. The pre-push hook runs it too.
- Run `bun typecheck` from a package directory to typecheck one package. Never run `tsc` directly.
