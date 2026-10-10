# @ren/schema

Effect Schema contracts shared by every layer. Browser-safe.

## What belongs here

- Branded IDs, entities and value objects (`Pod.ID`, `Agent.Info`).
- Wire and storage payload shapes used by more than one package.

## What does not

- HTTP endpoints (`@ren/protocol`).
- Drizzle tables (`@ren/db`).
- Behavior or services (`@ren/core`).

## Dependencies

`effect` only.

## Commands

```sh
bun run test
bun typecheck
```
