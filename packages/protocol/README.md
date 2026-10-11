# @ren/protocol

The public HTTP contract: `HttpApi` endpoint groups, middleware tags and API errors.

## What belongs here

- `src/groups/*.ts`: one `HttpApiGroup` per domain.
- `src/api.ts`: the assembled `HttpApi`.
- `src/client.ts`: the API shape handed to the client generator, plus consumer-facing group names.
- `src/errors.ts`: tagged API errors with HTTP statuses.
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
