# @ren/protocol

The public HTTP contract (`Api`): endpoint groups, middleware tags and errors. Ren serves it; the app, CLI and SDK call it.

## What belongs here

- `src/groups/*.ts`: one `HttpApiGroup` per domain.
- `src/api.ts`: the assembled `HttpApi`.
- `src/client.ts`: the API shape handed to the client generator.
- `src/errors.ts`: tagged API errors with HTTP statuses.
- `src/primitive.ts`: endpoint and group constructors for primitives.
- `src/exposure.ts`: the `Exposure` annotation every group carries.
- `script/contract.ts`: the API contract check, run by `bun run generate`.
- `src/middleware/*.ts`: middleware tags and the services they provide, such as `Authentication` and `CurrentUser`. The server implements them.
- `openapi.json`: generated. Do not edit.

## What does not

- Handler implementations (`@ren/server`).
- Domain shapes reused outside HTTP (`@ren/schema`).

## Dependencies

`@ren/schema`, `effect`.

## Commands

```sh
bun run generate
bun run check:generated
bun run test
bun typecheck
```
