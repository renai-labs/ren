# ren2 CLI

Status: partially implemented. The command/runtime foundation, binary release tooling and browser login are implemented. Device login, profiles, generated API coverage and structured output remain proposed. Publishing the first release requires running the release workflow. HTTP operations and domain shapes remain owned by the protocol and schema. Implementation work belongs in `TODO.md` or issues.

## 1. Purpose

`ren2` is the terminal client for Ren, used by people, scripts and agents. It combines OpenCode V2's typed command structure with ren-v1's generated API coverage and automation conventions.

The CLI calls Ren through `@renai-labs/sdk`. It owns argument parsing, terminal interaction, local configuration and file input/output. Authorization, reconciliation and domain rules remain on the server. Reusable API interaction belongs in the SDK/client.

The CLI must work alongside the published ren-v1 CLI:

- The executable, help, examples, completion and generated CLI documentation use `ren2`.
- Installing it must not replace the `ren` executable.
- The primary installation command fetches an `install.sh` shell script with curl and runs it with Bash.
- Its user configuration and credentials use a separate `ren2` location and do not overwrite ren-v1 state.
- The npm package name is a separate release decision. `@renai-labs/cli2` is proposed, not yet decided.
- The executable rename does not rename the `.ren/` infrastructure folder or Ren's domain concepts.

## 2. Baseline and references

The comparison behind this proposal inspected OpenCode V2's `packages/cli` at version 2.0.26, the original ren-v1 checkout, and this repository. OpenCode V1 is not the architectural reference.

### Current Ren

The CLI currently exposes five actions: `health` and `infra validate`, `plan`, `apply`, `pull`. Root dispatch is handwritten; infra uses `node:util.parseArgs`. Connections use `REN_URL`, defaulting to `http://localhost:4000`, and optional `REN_TOKEN`.

The useful existing behavior is preserved: SDK calls, shared-schema validation, file-and-field diagnostics, plan digests, explicit noninteractive archive handling, and filesystem/subprocess tests.

Relevant sources:

- [Entrypoint](../packages/cli/src/index.ts)
- [Connection](../packages/cli/src/connection.ts)
- [Infra commands](../packages/cli/src/infra/command.ts)
- [Infra folder adapter](../packages/cli/src/infra/folder.ts)

### OpenCode V2

Adopt typed `effect/cli` declarations, separate lazy-loaded handlers, a shared connection resolver, and a scoped Effect runtime. Its local background service and embedded server serve OpenCode's own runtime; Ren does not need those facilities to adopt its CLI structure.

Reference paths in the OpenCode checkout:

- `packages/cli/src/commands/commands.ts`
- `packages/cli/src/framework/spec.ts`
- `packages/cli/src/framework/runtime.ts`
- `packages/cli/src/services/server-connection.ts`
- `packages/cli/src/commands/handlers/api.ts`
- [V2 CLI documentation](https://opencode.ai/v2/docs/cli)

### ren-v1

The inspected generated manifest contains 250 operation descriptors across 36 resource groups, with custom handlers replacing or extending selected operations. This is manifest coverage, not a claim of end-to-end verification for every operation.

Preserve generated operation coverage, structured input, terminal-aware output, profiles, interactive/headless authentication workflows, and command discovery. Generate against the current contracts rather than copying old endpoints or nouns.

Reference paths in the ren-v1 checkout:

- `packages/client-core/src/generated/ops.ts`
- `packages/cli/src/runtime/executor.ts`
- `packages/cli/src/runtime/output.ts`
- `packages/cli/src/commands/tree.ts`
- `packages/cli/src/commands/overrides.ts`
- `packages/cli/src/commands/init.ts`

## 3. Command architecture

### 3.1 Definitions and execution

Keep help copy short and direct. Use brief verb phrases for commands and concise labels for arguments. Let the parser show defaults and syntax; reserve explanations for errors and documentation. Preserve distinctions that affect behavior, such as noninteractive requirements and supported pull scope.

Use `effect/cli` for command names, arguments, flags, descriptions and subcommands. Definitions drive parsing, help, completion and command documentation. Unknown flags, unsupported options and excess positional arguments fail with a usage error.

Separate command definitions from handlers. Load a selected handler lazily so help and discovery do not load every workflow. Bind handlers to the command definitions with inferred input types. Start with direct Effect composition; add a small framework only where generated commands and lazy loading require it.

One scoped Effect runtime owns each invocation. It supplies connection, configuration and output services, handles interruption and cleanup, and renders failures at the process boundary. Handlers do not independently create runtimes or exit the process.

Help, version, completion and local infrastructure validation work without credentials or a reachable server.

### 3.2 Generated operations and custom workflows

Generate ordinary API commands from the current SDK-exposed contracts:

- Primitive definitions supply domain names, plurals and supported actions.
- Protocol definitions supply operation IDs, request shapes, descriptions and errors.
- Exposure annotations determine the SDK surface available for generation.
- Generated adapters invoke the SDK; commands do not maintain a second HTTP implementation.

Do not infer plurals or create a handwritten endpoint registry. Preserve stable operation IDs independently of friendly command names. Generation must reject command-path collisions and ambiguous overrides.

Handwritten commands own workflows such as login, infra reconciliation, file uploads and streaming runs. A custom handler can explicitly replace a generated action without registering two commands at the same path. Discovery describes the effective command, including its custom input behavior.

Reusable generation mechanics belong in `@ren/httpapi-codegen`, which stays independent of Ren packages. Ren's generation scripts supply contracts and selection policy. Generated files follow the existing `bun run generate` workflow and are never edited by hand.

### 3.3 API access

Provide `ren2 api` as a diagnostic and low-level access command, accepting an operation ID or an HTTP method and path. It uses the same resolved endpoint and authentication as ordinary commands. It does not bypass server authorization or turn internal endpoints into generated public commands.

Any raw-request capability needed by this command belongs in the SDK/client transport. Operation lookup must identify which contract version it uses. Response bodies go to stdout, HTTP failures set a nonzero exit status, and diagnostics go to stderr. Raw response output is distinct from ordinary command JSON formatting and must be documented.

## 4. Connection, authentication and local state

Resolve connection context once per invocation and reuse it across all requests in a workflow. This includes the endpoint, credential and organization selection. In particular, infra planning and applying use the same resolved identity and endpoint.

Proposed precedence:

| Setting      | Precedence                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------- |
| Endpoint     | Explicit flag, environment, selected profile, documented default                            |
| Profile      | Explicit flag, environment, active profile                                                  |
| Credential   | Explicit environment credential, otherwise the credential for the selected endpoint/profile |
| Organization | Command-specific explicit target, otherwise selected profile context                        |

An endpoint override must not silently send a stored credential associated with another server. Invalid URLs and incomplete contexts produce actionable errors. Debug output must not reveal credential values.

For infra, `deploy.yaml` names the target organization. Resolve and check that target against the authenticated context; do not silently apply to a different active organization.

Keep connection profiles distinct from domain app profiles. A CLI profile selects a server, login and optional organization; an app profile represents accounts used by an app.

### 4.1 Login (implemented)

`ren2 login` uses OAuth 2.1 authorization code with PKCE against Ren's existing OAuth provider (the one MCP clients use), with a loopback callback on `127.0.0.1` and any free port. It discovers endpoints through protected resource metadata (RFC 9728) and authorization server metadata (RFC 8414), and requests `openid offline_access ren` for the server's protected resource. The person picks the organization on the consent page; the token is bound to it, so switching organizations means logging in again. `--no-browser` prints the URL only.

The CLI is a public native client identified by a Client ID Metadata Document URL, `Auth.cliClient.client_id` in `@ren/schema`. The server resolves that document itself rather than fetching it, so login works in development and on any deployment without depending on the release host.

Access tokens last an hour. The CLI refreshes a token within a minute of expiry and stores the rotated refresh token. The provider's 30-second refresh reuse window lets concurrent CLI processes refresh with the same token safely. `ren2 logout` revokes the refresh token and removes the credential. `ren2 whoami` shows the user and organization.

Credentials live in `$XDG_CONFIG_HOME/ren2/credentials.json` (default `~/.config/ren2`), written atomically with mode `0600`, keyed by server origin. A credential is sent only to the server that issued it. Endpoint precedence today is `REN_URL`, then the release's built-in API URL (`REN2_API_URL` at build time; `http://localhost:4000` from source). `REN_TOKEN` overrides stored credentials for CI and headless use.

### 4.2 Later

- Device authorization (RFC 8628) for SSH and remote machines. It needs the Better Auth device plugin, a migration and an approval page.
- Named profiles, a `--server` flag and explicit organization selection without a new login.

Project infrastructure declarations do not contain CLI login credentials.

## 5. Input, output and process behavior

### 5.1 Structured input

Generated commands expose path arguments, query flags and suitable scalar body flags. Nested bodies support `--body` with a JSON literal, `@file`, or `@-` for stdin. Scalar body flags override the corresponding fields in the supplied body, matching ren-v1's convention.

Validate input at the boundary using the current contracts. Preserve meaningful differences between omitted fields, explicit nulls and empty values. Unsupported shapes need an explicit input strategy rather than guessed scalar flags. File and binary uploads use purpose-built handlers where a JSON body is insufficient.

A command consuming stdin as data must not also use it for interactive confirmation.

### 5.2 Output

Ordinary commands accept `--output json|pretty`:

- Explicit selection wins.
- Default to pretty output when stdout is a terminal and JSON otherwise.
- Results go to stdout; progress, prompts and diagnostics go to stderr.
- JSON output contains structured results without banners, progress text or terminal formatting.
- JSON-mode failures are structured on stderr, including actionable validation details when available.
- Lists preserve pagination information. Fetching additional pages must be explicit and documented.

Finite commands emit one complete result. Streaming commands need a separately documented event format, such as newline-delimited JSON, and must not silently use an unbounded sequence where callers expect one JSON document.

The exact error envelope and exit-code taxonomy remain open. Success is zero; usage errors, request failures and interruption have documented nonzero behavior. Errors are rendered once at the process boundary.

### 5.3 Infrastructure

Keep `ren2 infra validate|plan|apply|pull` and the `.ren/` default folder. Preserve the existing interactive confirmation and noninteractive digest/archive rules. JSON plan output includes the structured changes, problems and digest, so scripts do not scrape a `Digest:` line.

The infrastructure scope is owned by [the infra design](infra.md) and [the Infra schema](../packages/schema/src/infra.ts). At the inspected baseline, validation accepts more declarations than reconciliation manages. `Infra.Kind` covers organization, space, agent and membership changes; `Infra.Pulled` covers organization settings, shared spaces and their agents. Private specs are unsupported.

Help and results must distinguish validation support from apply/pull support. Successful validation is not evidence that every declaration will be reconciled. As supported kinds expand, their pull/write behavior and meaningful round-trip verification must expand with them.

## 6. Coverage from ren-v1

Coverage is measured as user capabilities mapped to current contracts, not as preservation of every old command name. A missing CLI handler and a missing backend capability are separate gaps.

| ren-v1 capability                                   | Current direction                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Login, profiles, identity, organizations            | Current authentication and explicit connection context                                  |
| Pods, projects and membership                       | Map workflows to spaces, agents, apps and memberships; no mechanical noun replacement   |
| Sessions, messages, traces and usage                | Current session operations and supported Chat API interactions                          |
| Tasks, comments, events and labels                  | Task, comment, activity and label contracts                                             |
| Environments and builds                             | Environment providers, templates and space-template relationships                       |
| Skills, MCPs, blueprints and registry               | Apps, registry and infra, with custom file workflows where needed                       |
| Credentials, OAuth and inference                    | Generated operations plus custom authorization/connect workflows                        |
| Cron triggers                                       | Schedules and schedule runs                                                             |
| Provider and messaging integrations                 | Assess current channel install/mapping/connect and repository capabilities individually |
| Artifacts, file stores, memory stores and databases | Assess current storage/memory capabilities individually                                 |
| Billing, publishers, replays and onboarding         | Explicit product migration decisions                                                    |
| Upgrade, completion and docs                        | CLI release and discovery behavior                                                      |

Each legacy workflow must ultimately have a current equivalent, a documented replacement, or an explicit retirement decision. The operation-by-operation migration inventory belongs with implementation tracking, rather than duplicating evolving API definitions in this document.

Session streaming uses the SDK's Chat API surface and its access contract. It does not import server or harness internals into the CLI.

## 7. Package layout and distribution

Proposed layout:

```text
packages/cli/src/
  index.ts                 # runtime entrypoint
  commands.ts              # root command composition
  generated/               # generated command definitions/adapters
  commands/
    auth/
    infra/
    api.ts
    health.ts
  services/
    connection.ts          # resolved context and SDK client
    config.ts              # CLI profiles and preferences
    output.ts              # results and diagnostics
  infra/
    folder.ts              # filesystem <-> Infra schema
```

### 7.1 Primary installation

Publish a shell installer as the primary entrypoint. Keep the hosting origin in `REN2_HOST_URL`, currently `https://v2.useren.ai`. Release configuration and installation documentation use this variable so the origin can change at migration without changing installer paths or command behavior. This hosting variable is separate from the CLI's API endpoint selection.

The release workflow publishes the paths below; these examples require a published release:

```sh
export REN2_HOST_URL="https://v2.useren.ai"
curl -fsSL "${REN2_HOST_URL}/ren2/install.sh" | bash
curl -fsSL "${REN2_HOST_URL}/ren2/install.sh" | bash -s -- --version <version>
curl -fsSL "${REN2_HOST_URL}/ren2/install.sh" | bash -s -- --no-init
```

Keep the installer URL distinct from ren-v1's `https://useren.ai/install`. Its source references are ren-v1's `packages/site/src/scripts/install.sh` and OpenCode V2's root `install` script, served at `https://opencode.ai/v2/install`.

The two references use different delivery mechanisms: the inspected ren-v1 script runs `npm install -g`, while OpenCode V2 downloads a platform-specific binary. `ren2` downloads a self-contained, Bun-built binary, requiring no existing Node, npm or Bun installation.

Installer behavior:

- Detect the supported operating system and architecture and select the matching release artifact. Unsupported targets fail with an actionable message.
- Install the latest stable release by default; `--version` selects a specific release.
- Install into `~/.ren2/bin` without replacing or removing ren-v1 binaries or credentials.
- Add that directory to the shell path without duplicate entries. `--no-modify-path` skips shell configuration edits and prints the required setup.
- Download and verify the selected artifact before replacing an existing installation. A failed download or verification leaves the working installation intact.
- Verify the installed executable with `ren2 --version` and report its location.
- When stdout is a terminal, run `ren2 login`; a failed login does not fail the installation. Otherwise print `ren2 login` as the next step. `--no-init` skips both.
- Support `--help`; invalid options or missing option values fail clearly.

Support macOS and glibc Linux on arm64 and x64. Use the existing app S3 bucket and CloudFront distribution for `/ren2/*`, separate from `/app/*`. Verify each binary against its SHA-256 sidecar, then check its embedded version before replacement. Windows and musl Linux are not in this release matrix.

### 7.2 Release artifacts

Use a Bun-based build, consistent with the existing Bun filesystem and YAML APIs. Each binary includes its runtime. Verify the downloaded and installed executable outside the repository, not only source execution. Disable Bun's automatic project configuration and dotenv loading in compiled artifacts; connection configuration comes from the explicit CLI environment.

An npm package can be an additional installation route. If published, it exposes `ren2` through a coherent built bin entry and follows the same version and coexistence contract. The curl installation interface does not depend on choosing the npm package name.

The workspace package remains private and its bin points at source for development. `bun run build` produces versioned platform binaries, checksums and a rendered installer under `dist`. The `cli release` workflow builds and tests each target natively before publishing all artifacts, then updates the installer and `latest.txt`. Existing release versions are immutable. A Node-only release would require explicitly replacing Bun-specific runtime behavior; it is not assumed by this design.

Version output comes from release metadata. Completion scripts use `ren2`. Every installation route must coexist with ren-v1 without executable or configuration collisions. Upgrade behavior follows the selected installation method; a shell-installed binary upgrades through the same release artifacts without switching the user to npm.

## 8. Verification

Verify behavior at the lowest owning layer, using existing tests where possible:

- CLI subprocess tests for parsing failures, offline help, stdout/stderr separation and exit behavior.
- Connection tests for profile precedence and endpoint/credential association.
- Generator tests for real request-shape translation, command collisions and custom overrides.
- Infra tests for file diagnostics, supported round trips and digest/archive behavior.
- Real API integration tests for authentication and representative generated/custom workflows.
- Cancellation and stream tests using observable events rather than real-time waits.
- Installer/release smoke tests for default and pinned releases, noninteractive `--no-init`, `--no-modify-path`, repeat installation, failed-download preservation and coexistence with `ren`.
- Run `ren2 --help`, `ren2 --version` and a local file-validation workflow against the installed artifact outside the repository. Test the npm installation separately if that route is published.

Do not replace behavioral verification with snapshots of operation-name lists or tests of this specification. Generation checks establish coverage consistency; behavioral tests establish correctness.

## 9. Delivery dependencies and open decisions

The command/runtime foundation, output contract and package build precede expansion of the command surface. Connection context and the selected auth contract precede authenticated workflows. Generated operations then provide broad current-API coverage, with custom workflows layered on top. Legacy reconciliation distinguishes remaining CLI work from backend/product work.

Resolve before the affected feature ships:

1. npm package name; proposed `@renai-labs/cli2`.
2. Device authorization for headless login (section 4.2).
3. Named profiles and their config format.
4. Connection and organization flags.
5. Stable error envelope, exit codes and streaming output contract.
6. Generated command naming for nested resources and exceptions.
7. Additional platforms and any future package-manager installation routes. The initial binary/installer release contract is defined in section 7; `REN2_HOST_URL` remains configurable for migration.
8. Per-capability migration decisions for legacy features without a current equivalent.
