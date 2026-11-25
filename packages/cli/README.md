# @renai-labs/cli

The `ren` command-line interface.

## What belongs here

- Commands, argument parsing and terminal output.
- Calls to Ren through `@renai-labs/sdk`.

## What does not

- Business logic (`@ren/core`).
- Imports from `core`, `db` or `server`.

## Dependencies

`@renai-labs/sdk`. The generation script also uses `@ren/protocol` and `@ren/httpapi-codegen`, at build time only.

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

`ren login` opens the browser for OAuth with PKCE and a loopback callback on `127.0.0.1`. You choose the organization on the consent page; to switch organizations, run `ren login` again. `--no-browser` prints the URL only.

Credentials live in `$XDG_CONFIG_HOME/ren/credentials.json` (default `~/.config/ren`), mode `0600`, keyed by server origin, and are sent only to that server. Access tokens last an hour and refresh automatically. `ren logout` revokes the refresh token and removes the credential.

`REN_TOKEN` overrides stored credentials, for CI. Released binaries default to the production API; `REN_URL` selects another server.

The CLI's OAuth client ID is `Auth.cliClient.client_id` in `@ren/schema`. The server resolves that metadata document itself, so login works without fetching it.

## Output

`--output json|pretty` works on every command. Without it, output is pretty in a terminal and JSON when piped.

- Results go to stdout. In JSON, a result is the API value in its wire format, such as `Auth.Me` for `whoami` or `Infra.Plan` for `infra plan`, and nothing else.
- Progress, prompts and errors go to stderr. In JSON, an error is one line: `{"error":{"type":"NotFoundError","message":"…","resource":"space"}}`. `type` is the API error's tag with its fields, `UsageError`, or `CliError` for everything the CLI reports itself. Spec problems are listed in `problems`.
- Exit codes: `0` success, `1` failure, `2` usage error, `130` interrupted.

## Install

```sh
curl -fsSL https://useren.ai/install | bash
```

`/install` serves `/ren/install.sh`. To install from another release host, set `REN_HOST_URL` and fetch `$REN_HOST_URL/ren/install.sh`.

Pass `--version <version>` to pin a release or `--no-modify-path` to leave shell config alone. The installer verifies SHA-256 and the executable's version before replacing `~/.ren/bin/ren`. macOS and glibc Linux are supported on arm64 and x64. Bun and Node are not required.

In a terminal, the installer runs `ren login`; `--no-init` skips it.

`ren upgrade` installs the latest release, and `ren upgrade 0.2.0` a specific one. It checks the SHA-256 and the new executable's version before it replaces itself, so a failed upgrade keeps the working binary. Once a day, a terminal session prints `ren vX.Y.Z is available` after a command. The check never runs for JSON output, in CI or with `REN_NO_UPDATE_CHECK=1`, and it never delays a command by more than a second.

Shell completions:

```sh
ren --completions zsh > "${fpath[1]}/_ren"   # bash, zsh, fish or sh
```

## Build and release

```sh
bun run build --version 0.1.0
bun run build --version 0.1.0 --target linux-x64
bun run test
```

Builds use the current platform by default. `--outdir` defaults to `dist`. `REN_HOST_URL` sets the default release host of the generated installer and of `ren upgrade`, and overrides it at installation or upgrade time. `REN_API_URL` sets the binary's default API (default `http://localhost:4000`); the release workflow takes it from the environment's `REN_API_URL` variable.

```text
dist/
  install.sh
  releases/<version>/
    ren-<platform>-<arch>
    ren-<platform>-<arch>.sha256
```

Run the `cli release` GitHub workflow with a stable version (`X.Y.Z`). It builds and tests all four targets natively, uploads immutable artifacts under `/ren/releases/`, then publishes the installer and `latest.txt`. Existing release versions cannot be overwritten. It uses the `v2-prod` environment's AWS deployment role, app bucket and CloudFront distribution. `REN_HOST_URL` is an environment variable there, defaulting to `https://useren.ai`.

The npm package is private: the CLI ships only through the installer. ren-v1's `@renai-labs/cli` 0.x on npm is deprecated.

## Architecture

- `src/commands.ts` declares typed Effect commands, arguments and flags.
- `src/app.ts` binds those declarations to lazy-loaded handlers.
- `src/runtime.ts` runs one scoped invocation, routes help, renders each failure once in the chosen format with its exit code, and leaves signal handling to the Bun Effect runtime.
- `src/services/connection.ts` resolves the server and token once, refreshing a stored token when it is about to expire, and creates SDK clients.
- `src/services/credentials.ts` stores tokens per server; `src/services/oauth.ts` discovers the server's OAuth endpoints and makes the token requests.
- `src/services/output.ts` owns the output format, results encoded with their schema, diagnostics, `Output.Failure` and terminal confirmation.
- `src/infra/folder.ts` maps local files to and from the shared Infra schema.
- `src/generated/` holds the generated resource commands. Never edit it.
- `src/operation.ts` runs a generated command: it resolves names to IDs in arguments, flags and `--input`, decodes flags and `--input` with the endpoint's own schemas, calls the SDK and renders the result.

## Resource commands

Every SDK operation is a command, named the way large platform CLIs name theirs: `ren <noun> [<sub-noun>] <verb> [<resource>] [flags]`.

```sh
ren space list
ren space create --name Docs --slug docs
ren space update docs --description "Writes the docs"
ren space member add docs --email ada@example.com
ren task create --space docs --title "Fix the build" --labels ci,urgent
ren task comment add <task> --body "On it"
ren schedule run nightly
```

Where a resource has a human name, the name works wherever its ID does, in arguments, flags and `--input`: a space’s, app’s, schedule’s or webhook’s slug, an agent’s or environment template’s name, a task’s number such as `REN-12`, and the organization’s slug. Each argument’s help says which. Plural nouns are accepted (`ren spaces list`). Nested fields come through `--input` (JSON, `@file` or `@-`), and flags override it.

The names come from the table in `script/generate.ts`. After a change to `@ren/protocol` or the table, run `bun run generate` from the repo root. Generation fails while an SDK operation is neither in the table nor listed with the command that covers it, so a new endpoint is never silently missing.
