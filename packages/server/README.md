# @ren/server

The API process: HTTP handlers, middleware implementations and runtime composition.

## What belongs here

- `src/auth.ts`: the Better Auth config and `Auth.Service`, which resolves a request to its user and active organization once. `Auth.make` is shared with `script/auth-config.ts`, which the Better Auth CLI reads to generate `packages/db/src/auth.sql.ts`.
- `src/api.ts`: the concrete `HttpApi` (protocol plus server-supplied middleware).
- `src/handlers/*.ts`: one `HttpApiBuilder.group` per protocol group. Keep them thin.
- `src/middleware/*.ts`: implementations of `@ren/protocol` middleware, such as `AuthenticationLayer`.
- `src/routes.ts`: the composed router layer, including Better Auth at `/auth/*` and CORS for `TRUSTED_ORIGINS`.
- `src/main.ts`: process entry point.

## What does not

- Business rules (`@ren/core`).
- Endpoint shapes (`@ren/protocol`).

## Dependencies

`@ren/core`, `@ren/db`, `@ren/protocol`, `@ren/schema`, `@ren/util`, `@effect/platform-bun`, `effect`, `better-auth` and its Drizzle adapter.

## Commands

```sh
bun run dev   # port 4000, or PORT; reads the repo root .env
bun run test
bun typecheck
bun run generate   # regenerate packages/db/src/auth.sql.ts
```
