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
- `host-api` holds the internal contracts between Ren and a session's host, one per direction: `BrainApi` (`cell` serves, `core` calls) and `RenHostApi` (`server` serves, `cell` calls). It depends only on `schema`. `cell` depends only on `schema`, `host-api`, `environment-api`, `brain` and the Chat API (`@ren/protocol/chat`, which it serves to clients).
- `environment-api` is the internal contract between a brain and an environment's executor, and the environment token Ren signs for it: it depends only on `schema`; `core` signs, `brain` calls and `executor` serves.
- `executor` runs on an environment's machine and serves the Environment API. It depends only on `schema` and `environment-api`.
- `brain` holds brain code that is the same on every host and every harness: how a brain reaches its environment. It depends only on `schema` and `environment-api`.
- `client` may depend only on `schema` and `protocol`. `chat` builds on `client`, `schema` and `protocol` and is the live chat runtime for every client platform. `sdk` builds on `client`; `cli` builds on `sdk`; `app` builds on `client`, `chat`, `schema`, `ui` and `util`, and uses `better-auth/client` for auth flows.
- `util` is browser-safe and imports nothing from Ren: generic helpers with a second user go there, Ren concepts go in `schema`.
- `client`, `chat`, `sdk`, `cli`, `app` and `ui` never import `core`, `db`, `server`, `host-api` or `environment-api`.
- `httpapi-codegen` stays independent of every Ren package.
- `repos/` holds read-only copies of external repositories. Prefer their patterns over memory or web search. Do not edit or import them.

## Style

Lint enforces most style rules. Run `bun run check` and follow each message. These rules need judgment:

- Keep logic in one function unless it is composable or reusable. Do not extract single-use helpers. Inline single-use variables.
- Validate unknown input once at the boundary; trust the resulting types afterwards.
- Avoid `try`/`catch` and unchecked casts.
- Prefer Bun APIs, such as `Bun.file()`, when they fit.
- Rely on type inference; add explicit annotations only for exports or when inference fails.
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops. Use type guards on `filter` to keep inference downstream.
- Avoid destructuring; use dot access.
- Pass a boolean that sits next to other parameters in an options object (`grantAccess(subject, { isRetry: true })`), never as a bare `true` or `false`.
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
- A test that takes more than 5 seconds is slow. When you add or change a test, or any run shows a test that takes that long, move it to a `<name>.slow.test.ts` file beside the original and share its helpers through `test/lib`. `bun run test` prints only failures, so run `bun test <file>` to see each test's duration. `bun run test` skips `*.slow.test.ts` files unless `REN_SLOW=1` is set; CI sets it. A test that runs into its timeout is broken, not slow: fix it, do not move it.

## Checks

- Run `bun run check` from the repo root before pushing. The pre-push hook runs it too.
- Run `bun typecheck` from a package directory to typecheck one package. Never run `tsc` directly.
