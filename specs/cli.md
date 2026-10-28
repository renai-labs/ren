# ren2 CLI: pending

`ren2` is the terminal client for Ren. Built: the command runtime on `effect/cli`, commands generated from the SDK operations, `--input`, the JSON and pretty output with its error envelope and exit codes, browser login with OAuth and PKCE, `ren2 infra`, binary releases with the curl installer, `ren2 upgrade`, the update notice and shell completions (`packages/cli`). The CLI calls Ren only through the SDK; authorization and domain rules stay on the server.

## 1. `ren2 api`

A diagnostic and low-level command. It takes an operation ID, or an HTTP method and a path.

1. It uses the same endpoint and authentication as other commands. It does not bypass server authorization, and it does not make internal endpoints into public commands.
2. A raw-request capability goes in the SDK/client transport, not in the CLI. Operation lookup names the contract version it uses.
3. The response body goes to stdout, an HTTP failure sets a nonzero exit code, and diagnostics go to stderr. Raw output is different from the JSON output of other commands, and is documented.

Proposed file: `src/commands/api.ts`.

## 2. Connection profiles

A CLI profile selects a server, a login and an optional organization. It is not an app profile. Resolve the connection once per invocation and use it for every request of a workflow; infra plan and apply use the same identity and endpoint.

| Setting      | Precedence                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------- |
| Endpoint     | Explicit flag, environment, selected profile, documented default                            |
| Profile      | Explicit flag, environment, active profile                                                  |
| Credential   | Explicit environment credential, otherwise the credential for the selected endpoint/profile |
| Organization | Command-specific explicit target, otherwise selected profile context                        |

1. An endpoint override never sends a stored credential of another server.
2. Debug output never shows a credential value.
3. For infra, `deploy.yaml` names the target organization. Check it against the signed-in context; never apply to another active organization.

Today the endpoint is `REN_URL`, then the release's built-in API URL, and switching organizations needs a new login. Pending: named profiles and their config format (`src/services/config.ts`), a `--server` flag, and organization selection without a new login.

## 3. Device login

Device authorization (RFC 8628) for SSH and remote machines. It needs the Better Auth device plugin, a migration and an approval page.

## 4. Chat and streaming

1. Chat uses the SDK's Chat API and its access contract. It imports no server or harness code.
2. A streaming command writes newline-delimited JSON, one event per line. Document the event format with the first streaming command.
3. A finite command writes one complete result.

## 5. Coverage of ren-v1 workflows

Each ren-v1 CLI workflow gets a current equivalent, a documented replacement, or an explicit retirement. A missing CLI handler and a missing backend capability are separate gaps.

| ren-v1 capability                                   | Direction                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pods, projects and membership                       | Map workflows to spaces, agents, apps and memberships; no mechanical noun replacement |
| Sessions, messages, traces and usage                | Current session operations and the Chat API                                           |
| Skills, MCPs, blueprints and registry               | Apps, registry and infra, with custom file workflows where needed                     |
| Credentials, OAuth and inference                    | Generated operations plus custom connect workflows                                    |
| Provider and messaging integrations                 | Decide each one against the channel install, mapping and repository capabilities      |
| Artifacts, file stores, memory stores and databases | Decide each one against the storage and memory capabilities                           |
| Billing, publishers, replays and onboarding         | Explicit product migration decisions                                                  |

File and binary uploads use their own handlers where a JSON body is not enough.

## 6. Open decisions

1. The npm package name, if an npm route is published. Proposed: `@renai-labs/cli2`. It exposes `ren2`, and it never replaces the `ren` executable of ren-v1.
2. More platforms: Windows and musl Linux are not in the release matrix.
