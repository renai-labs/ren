# @ren/server

The API process: HTTP handlers, middleware implementations and runtime composition.

## What belongs here

- `src/api.ts`: the concrete `HttpApi` (protocol plus server-supplied middleware).
- `src/handlers/*.ts`: one `HttpApiBuilder.group` per protocol group. Keep them thin.
- `src/routes.ts`: the composed router layer, including Better Auth at `/api/auth/*` and CORS for `TRUSTED_ORIGINS`.
- `src/main.ts`: process entry point.

## What does not

- Business rules (`@ren/core`).
- Endpoint shapes (`@ren/protocol`).

## Dependencies

`@ren/core`, `@ren/db`, `@ren/protocol`, `@ren/schema`, `@ren/util`, `@effect/platform-bun`, `effect`.

## Commands

```sh
bun run dev   # port 4000, or PORT; reads the repo root .env
bun run test
bun typecheck
```
