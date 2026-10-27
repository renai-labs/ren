# @renai-labs/cli

The `ren2` command-line interface.

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
bun run dev -- --help
bun run dev -- infra apply --help
bun run test
bun typecheck
```

`REN_TOKEN` supplies a bearer token. Help, version and local spec validation work without a connection.

## Architecture

- `src/commands.ts` declares typed Effect commands, arguments and flags.
- `src/app.ts` binds those declarations to lazy-loaded handlers.
- `src/runtime.ts` runs one scoped invocation, routes help and failures, and leaves signal handling to the Bun Effect runtime.
- `src/services/connection.ts` resolves the environment configuration once and creates a shared SDK client on first use.
- `src/services/output.ts` owns result output, diagnostics and terminal confirmation.
- `src/infra/folder.ts` maps local files to and from the shared Infra schema.

Results and requested help go to stdout; usage failures, diagnostics and confirmation prompts go to stderr. Failures exit with status 1 and interruption with status 130. Infra retains its current human-readable output; structured output and generated API coverage are later phases of the [CLI design](../../specs/cli.md).
