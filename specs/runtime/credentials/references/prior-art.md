# Prior art and host facts

Evidence for [`../README.md`](../README.md). Repositories were read on 2026-10-23.

## Products

| Product                             | Where the agent loop runs    | How a credential reaches an upstream                                                                                                                                                                   | Source                                                                                                            |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| ren-v1                              | in the sandbox               | Environment variables `MCP_<SLUG>_*` in the VM. Composio only: Ren's `/api/mcp-proxy/:podId/:mcpId` adds `x-api-key`.                                                                                  | `ren-v1/packages/api/src/server/routes/mcp-proxy.ts`, commit `fc4bc0eac`                                          |
| yc-software/qm                      | in core (server)             | Core makes MCP calls and reads the token again on each call. A broker takes a credential name and a URL, pins the host, adds the header and refuses redirects. Its egress proxy only allows or denies. | `qm/docs/mcp-connectors.md:13-48`, `qm/src/api/credential-broker.ts:100-126`, `qm/src/egress-authz-main.ts:52-63` |
| truefoundry/trueforge               | on the server                | "Model and MCP credentials never enter the sandbox." Sandbox secrets use Daytona's injection per host.                                                                                                 | `trueforge/docs/sandbox.mdx:19-25`, `:111`                                                                        |
| omnara-ai/omnara                    | in workers (server)          | MCP auth references a secret id. Machines get `secret_env`.                                                                                                                                            | `omnara/docs/tools/mcp.mdx:45-46`, `omnara/docs/organization/secrets.mdx`                                         |
| cloudflare/cloudflare-os            | Workers                      | A Gatekeeper Worker per service holds OAuth and is the MCP client. Reads run at once; writes wait for approval.                                                                                        | `cloudflare-os/packages/gatekeeper-mcp/README.md`                                                                 |
| multica-ai/multica                  | daemon on the user's machine | A per-task forwarder on 127.0.0.1 with a random path token. It adds the credential, allows approved tools only, and checks the credential again before each call.                                      | `multica/server/internal/daemon/remote_mcp_broker.go:55-185`                                                      |
| Docker Sandboxes                    | in the sandbox               | A proxy on the host replaces a placeholder with the real value. An MCP gateway connects to MCP servers for the agent.                                                                                  | docs.docker.com/ai/sandboxes/security/credentials                                                                 |
| Infisical Agent Vault (open source) | any                          | HTTPS proxy with its own store. The sandbox holds a session token in `HTTPS_PROXY`. Swaps in path, query, header, body and WebSocket frames.                                                           | `Infisical/agent-vault` README, `docs/learn/security.mdx`                                                         |
| NVIDIA OpenShell                    | in its sandbox               | Placeholders bound to hosts. A supervisor inside the sandbox resolves the real value. The gateway mints OAuth, GCP and AWS STS credentials.                                                            | `NVIDIA/OpenShell` `architecture/sandbox.md`, docs.nvidia.com/openshell                                           |
| paradigmxyz/iron-proxy              | any                          | HTTPS proxy with DNS. Swaps proxy tokens. gRPC hook. Section in [`iron-proxy.md`](iron-proxy.md).                                                                                                      | `paradigmxyz/iron-proxy` README                                                                                   |
| CyberArk Secretless Broker          | any                          | Connection broker for Postgres, MySQL, MSSQL, SSH, SSH agent and HTTP. Runs next to the application.                                                                                                   | `cyberark/secretless-broker` README                                                                               |
| Envoy `credential_injector`         | any                          | Adds a Bearer or Basic header, or an OAuth2 client-credentials token. One credential per workload.                                                                                                     | envoyproxy.io, credential injector filter                                                                         |
| mitmproxy                           | any                          | Programmable HTTPS proxy. Its proxy-auth add-on has a `socks5_auth` hook.                                                                                                                              | `mitmproxy/addons/proxyauth.py`                                                                                   |
| 1Password                           | —                            | Not a proxy. Browser autofill for agents, an OpenShell integration with placeholders, a Credential Broker for CI. A source for iron-proxy (`1password`, `1password_connect`).                          | developer.1password.com/docs/agentic-autofill                                                                     |

Common pattern: the egress holds the credential and the workload holds a placeholder. The weak point in most products is the identity of the caller. Agent Vault and qm put a token in the sandbox. Docker and OpenShell use the host.

## Hosts and providers

### E2B

| Fact                                                                                                                                                           | Source                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| BYOP sends all outbound TCP of a sandbox through a SOCKS5 proxy. Nothing runs in the sandbox; code there cannot see the proxy.                                 | `docs.e2b.dev/network/byop.md`                        |
| `username` and `password` (RFC 1929, up to 255 bytes each) are set per sandbox.                                                                                | `byop.md:137-138`                                     |
| `updateNetwork` sets or replaces the proxy on a running sandbox without a restart.                                                                             | `byop.md:144`                                         |
| An update without `egressProxy` turns tunnelling off; traffic then goes out directly.                                                                          | `byop.md:180`                                         |
| The password is never returned.                                                                                                                                | `byop.md:202`                                         |
| BYOP tunnels TCP only. Egress fails closed when the proxy is unreachable.                                                                                      | `byop.md`, "How it works"                             |
| The docs do not say whether BYOP survives pause and resume.                                                                                                    | —                                                     |
| E2B Secrets inject headers per host, HTTPS only, with 100 secrets per project on paid plans. A missing secret drops the header and the request still goes out. | `docs.e2b.dev/secrets/inject.md`, `secrets/limits.md` |

### Cloudflare, workerd, celld

| Fact                                                                                                                                                                    | Source                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Outbound Workers (Workers for Platforms) "do not intercept fetch requests made from Durable Objects".                                                                   | developers.cloudflare.com, Outbound Workers               |
| Dynamic Workers: `globalOutbound` sends every `fetch()` and `connect()` of a loaded Worker to a gateway. `props` carry per-tenant data that the loaded code cannot see. | developers.cloudflare.com, Dynamic Workers egress control |
| workerd sets `globalOutbound` per Worker in its config.                                                                                                                 | `cloudflare/workerd` `src/workerd/server/workerd.capnp`   |
| celld follows the Cloudflare Workers API. It trusts application code ("one fleet runs one application"). It supports the Worker Loader with `globalOutbound`.           | `denoland/celld` `docs/security.md`, `docs/README.md`     |
| Ren runs celld `0.6.2` in development.                                                                                                                                  | `packages/cell/docker/Dockerfile`                         |

### AWS KMS

| Fact                                                                                                                | Source                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Ed25519 keys since Nov 2025: key spec `ECC_NIST_EDWARDS25519`, algorithm `ED25519_SHA_512` with `MessageType: RAW`. | docs.aws.amazon.com/kms, key spec reference |
| The private key never leaves KMS. `GetPublicKey` exports the public key.                                            | same                                        |
