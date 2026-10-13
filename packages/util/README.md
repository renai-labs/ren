# @ren/util

Small shared helpers with no domain knowledge. Browser-safe: the app, server and test harnesses all import it.

## What belongs here

- Generic helpers with more than one user: text search, pathnames, port parsing, version info.

## What does not

- Anything that knows about Ren domains. Those go in `@ren/schema`.
- Node, Bun or platform APIs. oxlint rejects them.

## Dependencies

`effect` only.

## Commands

```sh
bun run test
bun typecheck
```
