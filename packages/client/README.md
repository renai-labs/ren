# @ren/client

Clients generated from the protocol `HttpApi`. Private; published through `@renai-labs/sdk`.

## What belongs here

- `@ren/client`: zero-Effect Promise client using `fetch` (`src/generated/`).
- `@ren/client/effect`: Effect client with decoded schema values (`src/effect/generated/`).
- Hand-written entrypoints that re-export generated code.

## What does not

- Edits to generated files. Run `bun run generate` instead.
- Imports from `core`, `db` or `server`.

## Dependencies

`@ren/schema`, `@ren/protocol`; `effect` as an optional peer.

## Notes

`test/import-boundaries.test.ts` bundles each entrypoint and fails if the Promise client pulls in Effect, schema or protocol, or if any entrypoint pulls in core, db or server.

## Commands

```sh
bun run generate
bun run check:generated
bun run test
bun typecheck
```
