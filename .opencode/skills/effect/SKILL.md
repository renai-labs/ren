---
name: effect
description: Work with Effect v4 TypeScript code in this repo
---

# Effect

Ren uses Effect v4 for services, schemas, HTTP APIs, database access and tests.

## Source of truth

Use the vendored Effect v4 source, not memory or older Effect v2/v3 examples.

1. Read `repos/effect/LLMS.md` before writing Effect code.
2. Search `repos/effect` for exact APIs, examples, tests and naming patterns before answering or implementing. Package sources live under `repos/effect/packages/*/src`.
3. Inspect nearby Ren code for house style before introducing new patterns.
4. Back answers and implementations with specific source files or nearby repo examples.

## Guidelines

- Use `Effect.gen(function* () { ... })` for multi-step workflows.
- Use `Effect.fn("Name")` for service methods and important workflows.
- Define services as `class Service extends Context.Service<Service, Interface>()("@ren/<package>/<Name>") {}` with an explicit `layer`.
- Bind services to named variables before calling methods. Do not nest service yields such as `(yield* X.Service).method()`.
- Die with `new Error(...)`, never a string.
- Pure helpers do not return `Effect`.
- Decode JSON with `Schema.UnknownFromJsonString` or a schema decoder, not `JSON.parse`.
- Use Effect `Schema` for API and domain shapes, branded schemas for IDs, and tagged schema errors for domain errors.
- Keep HTTP handlers thin: decode input, call services, map errors. Business rules live in `@ren/core` services.
- Prefer Effect platform abstractions (`HttpClient`, `FileSystem`, `SqlClient`) over ad hoc promises.
- Keep layer composition explicit.
- Do not introduce `any`, non-null assertions, unchecked casts or older Effect APIs to satisfy types.

## Testing patterns

- Use `testEffect(layer)` for tests that exercise services, layers or scoped resources: from `@ren/core/testing` in core and server, and from `@ren/executor/testing` in executor, brain and cell.
- Use `it.live(...)` for the filesystem, child processes, HTTP servers, the database or real time.
- Use `Testing.layer` from `@ren/db/testing` for database tests.
- Run tests from package directories; never from the repo root.
