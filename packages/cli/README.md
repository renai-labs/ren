# @renai-labs/cli

The `ren` command-line interface.

## What belongs here

- Commands, argument parsing and terminal output.
- Calls to Ren through `@renai-labs/sdk`.

## What does not

- Business logic (`@ren/core`).
- Imports from `core`, `db` or `server`.

## Dependencies

`@renai-labs/sdk`.

## Commands

```sh
bun run dev -- health   # REN_URL defaults to http://localhost:4000
bun run test
bun typecheck
```
