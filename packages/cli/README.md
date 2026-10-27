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
bun run dev -- login    # REN_URL defaults to http://localhost:4000
bun run dev -- whoami
bun run dev -- --help
bun run test
bun typecheck
```

Help, version and local spec validation work without a connection.

## Sign in

`ren2 login` opens the browser for OAuth with PKCE and a loopback callback on `127.0.0.1`. You choose the organization on the consent page; to switch organizations, run `ren2 login` again. `--no-browser` prints the URL only.

Credentials live in `$XDG_CONFIG_HOME/ren2/credentials.json` (default `~/.config/ren2`), mode `0600`, keyed by server origin, and are sent only to that server. Access tokens last an hour and refresh automatically. `ren2 logout` revokes the refresh token and removes the credential.

`REN_TOKEN` overrides stored credentials, for CI. Released binaries default to the production API; `REN_URL` selects another server.

The CLI's OAuth client ID is `Auth.cliClient.client_id` in `@ren/schema`. The server resolves that metadata document itself, so login works without fetching it.

## Output

`--output json|pretty` works on every command. Without it, output is pretty in a terminal and JSON when piped.

- Results go to stdout. In JSON, a result is the API value in its wire format, such as `Auth.Me` for `whoami` or `Infra.Plan` for `infra plan`, and nothing else.
- Progress, prompts and errors go to stderr. In JSON, an error is one line: `{"error":{"type":"NotFoundError","message":"…","resource":"space"}}`. `type` is the API error's tag with its fields, `UsageError`, or `CliError` for everything the CLI reports itself. Spec problems are listed in `problems`.
- Exit codes: `0` success, `1` failure, `2` usage error, `130` interrupted.

## Install

After the first release is published:

```sh
export REN2_HOST_URL="https://v2.useren.ai"
curl -fsSL "${REN2_HOST_URL}/ren2/install.sh" | bash
```

Pass `--version <version>` to pin a release or `--no-modify-path` to leave shell config alone. The installer verifies SHA-256 and the executable's version before replacing `~/.ren2/bin/ren2`. macOS and glibc Linux are supported on arm64 and x64. Bun and Node are not required.

Rerun the installer to upgrade. In a terminal, the installer runs `ren2 login`; `--no-init` skips it.

## Build and release

```sh
bun run build --version 0.1.0
bun run build --version 0.1.0 --target linux-x64
REN_SLOW=1 bun run test
```

Builds use the current platform by default. `--outdir` defaults to `dist`. `REN2_HOST_URL` sets the generated installer's default host and can also override it at installation time. `REN2_API_URL` sets the binary's default API (default `http://localhost:4000`); the release workflow uses the environment's `REN_API_URL`.

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
- `src/runtime.ts` runs one scoped invocation, routes help, renders each failure once in the chosen format with its exit code, and leaves signal handling to the Bun Effect runtime.
- `src/services/connection.ts` resolves the server and token once, refreshing a stored token when it is about to expire, and creates SDK clients.
- `src/services/credentials.ts` stores tokens per server; `src/services/oauth.ts` discovers the server's OAuth endpoints and makes the token requests.
- `src/services/output.ts` owns the output format, results encoded with their schema, diagnostics, `Output.Failure` and terminal confirmation.
- `src/infra/folder.ts` maps local files to and from the shared Infra schema.

Results and requested help go to stdout; usage failures, diagnostics and confirmation prompts go to stderr. Failures exit with status 1 and interruption with status 130. Infra retains its current human-readable output; structured output and generated API coverage are later phases of the [CLI design](../../specs/cli.md).
