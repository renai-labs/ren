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

## Install

After the first release is published:

```sh
export REN2_HOST_URL="https://v2.useren.ai"
curl -fsSL "${REN2_HOST_URL}/ren2/install.sh" | bash
```

Pass `--version <version>` to pin a release or `--no-modify-path` to leave shell config alone. The installer verifies SHA-256 and the executable's version before replacing `~/.ren2/bin/ren2`. macOS and glibc Linux are supported on arm64 and x64. Bun and Node are not required.

Rerun the installer to upgrade. Login comes in the next phase; `--no-init` currently skips the getting-started hint.

## Build and release

```sh
bun run build --version 0.1.0
bun run build --version 0.1.0 --target linux-x64
REN_SLOW=1 bun run test
```

Builds use the current platform by default. `--outdir` defaults to `dist`. `REN2_HOST_URL` sets the generated installer's default host and can also override it at installation time.

```text
dist/
  install.sh
  releases/<version>/
    ren2-<platform>-<arch>
    ren2-<platform>-<arch>.sha256
```

Run the `cli release` GitHub workflow with a stable version (`X.Y.Z`). It builds and tests all four targets natively, uploads immutable artifacts under `/ren2/releases/`, then publishes the installer and `latest.txt`. Existing release versions cannot be overwritten. It uses the `v2-prod` environment's AWS deployment role, app bucket and CloudFront distribution. `REN2_HOST_URL` is an environment variable there, defaulting to `https://v2.useren.ai`.

The npm package is private until its publication name and install format are decided.

## Architecture

- `src/commands.ts` declares typed Effect commands, arguments and flags.
- `src/app.ts` binds those declarations to lazy-loaded handlers.
- `src/runtime.ts` runs one scoped invocation, routes help and failures, and leaves signal handling to the Bun Effect runtime.
- `src/services/connection.ts` resolves the environment configuration once and creates a shared SDK client on first use.
- `src/services/output.ts` owns result output, diagnostics and terminal confirmation.
- `src/infra/folder.ts` maps local files to and from the shared Infra schema.

Results and requested help go to stdout; usage failures, diagnostics and confirmation prompts go to stderr. Failures exit with status 1 and interruption with status 130. Infra retains its current human-readable output; structured output and generated API coverage are later phases of the [CLI design](../../specs/cli.md).
