# Providers

Read on 29 Oct 2026. Read only.

## 1. treg

Sources: `https://treg.to/docs`, `https://treg.to/skill.md`, `https://treg.to/openapi.json`.

| Fact                                                                                                                                                                                                   | Source              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| One base URL and one token in `X-Treg-Token`. A call is `POST /call/<endpoint id>` with the provider's own path, parameters and answer.                                                                | `/docs`             |
| About 4,000 endpoints from 120 providers. Image, video, voice, music, search, people and company enrichment, social data.                                                                              | `/catalog`          |
| A raw endpoint does not fall back to another provider. A routed tool (`treg.<job>`, for example `treg.people.email.find`) tries providers cheapest first, within `X-Treg-Route-Max-Cost` (default $1). | `/docs`, `skill.md` |
| The charge is the response header `X-Treg-Cost-Micro` (micro-USD). `X-Treg-Call-Id` names the call.                                                                                                    | `skill.md`          |
| A miss can be billed.                                                                                                                                                                                  | `skill.md`          |
| `Idempotency-Key` replays a paid answer with `X-Treg-Cost-Micro: 0`.                                                                                                                                   | `skill.md`          |
| Video and image generation are async. The start holds the price and returns a task id. The task is charged only on success. A failed or moderated task gives the whole hold back.                      | `skill.md`          |
| `X-Treg-Async` says where to poll and which states are final. Check after about 60 s, then every 30 to 60 s.                                                                                           | `skill.md`          |
| treg polls an async provider for up to 60 s before it answers 202.                                                                                                                                     | `skill.md`          |
| Result links expire (`ttl_note`). treg stores no media.                                                                                                                                                | `skill.md`          |
| After a 429, a 5xx or a timeout, use the next provider. Do not retry a 4xx.                                                                                                                            | `skill.md`          |
| No job webhook. The only `webhook_url` in the OpenAPI is on user sign-up (`UserIn`).                                                                                                                   | `openapi.json`      |
| `GET /calls`, `GET /calls/{call_ref}`, `GET /calls/{call_id}/result` list and read calls.                                                                                                              | `/docs`             |

## 2. Kernel

Read on 31 Oct 2026. Sources: `https://api.onkernel.com/spec.json`, `https://www.kernel.sh/docs/llms.txt` and the pages it lists, `https://github.com/kernel/kernel-mcp-server` (MIT, commit `ad18ef3`).

| Fact                                                                                                                                                                                                                                                                                                    | Source                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Price for each second of active time: headless $0.0000166667 (1 GiB), headful $0.0001333336 (8 GiB), headful with GPU $0.0008000016. It is $0.0000166667 for each GiB-second.                                                                                                                           | `info/pricing`                                    |
| A browser idle for 5 s goes to standby and costs nothing. `timeout_seconds` (10 s to 72 h, default 60 s) deletes a browser after that much inactivity.                                                                                                                                                  | `info/pricing`, spec `BrowserRequest`             |
| Kernel's own proxies are not billed.                                                                                                                                                                                                                                                                    | `proxies/overview`                                |
| Unlimited projects need the Start-Up plan. Developer and Hobbyist have 1 project.                                                                                                                                                                                                                       | `info/pricing`                                    |
| A project has its own browsers, profiles, credentials, proxies, extensions, deployments and pools. The header `X-Kernel-Project-Id` (SDK `projectID`) scopes a request.                                                                                                                                 | `info/projects`                                   |
| A key can have a policy: actions `browsers`, `profiles`, `vaults`, `proxies` × `create`, `read`, `use`, `write`, `delete` on `projects/<id>/*`. Such a key gets `403 insufficient_scope` on API keys, pools, projects, app invocations, telemetry export, extensions on create, and any other endpoint. | `info/api-key-permissions`, `info/api-keys`       |
| `GET /browsers?status=deleted` gives `usage.uptime_ms` and `usage_status: pending \| ready` ("whether final usage billing is still pending or complete"). Also `memory`, `gpu`, `tags`, `deleted_at`.                                                                                                   | spec `Browser`, `BrowserUsage`                    |
| `POST /browsers` takes `tags` (up to 50 pairs, values `A-Za-z0-9 _.:/=+@-`). `PATCH /browsers/<id>` can change them.                                                                                                                                                                                    | spec `BrowserRequest`, `Tags`                     |
| No webhooks.                                                                                                                                                                                                                                                                                            | `llms.txt`                                        |
| The hosted MCP server `https://mcp.onkernel.com/mcp` accepts an API key as `Bearer` ("non-JWT tokens are treated as API keys").                                                                                                                                                                         | `reference/mcp-server/authentication`             |
| The MCP server has 34 tools (`src/lib/mcp/tool-names.ts`). A project-scoped key pins every operation to its project (`src/lib/mcp/project-selection.ts:54-69`).                                                                                                                                         | `kernel-mcp-server`                               |
| The MCP server makes browsers in `manage_browsers` (`action: "create"`, takes `tags`, `browsers.ts:517`) and `manage_profiles` (`action: "setup"`, no tags, `profiles.ts:194`; the reply names `session id: <id>`, `:209`).                                                                             | `kernel-mcp-server`                               |
| SDK: `@onkernel/sdk` 0.139.0, no dependencies.                                                                                                                                                                                                                                                          | npm                                               |
| `GET /browsers?status=deleted` lists the newest `deleted_at` first. `PATCH /browsers/<id>` replaces all tags.                                                                                                                                                                                           | Run on 31 Oct 2026                                |
| `GET /auth/context` answers `403 insufficient_scope` ("not supported for scoped credentials yet") to a key with a policy, so `mcp.onkernel.com` refuses that key. A key with only `project_id` works.                                                                                                   | Run on 31 Oct 2026; `src/lib/mcp/auth-context.ts` |

## 3. Other job APIs

| Provider                             | Status and result                                                           | Result kept                   | Webhook                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| fal                                  | `GET …/requests/{id}/status`, `GET …/requests/{id}`                         | 1 h; 6 min when 10 KB or more | Yes, `webhook_url` for each request                                         |
| OpenAI `/videos`                     | `GET /videos/{id}`, `GET /videos/{id}/content`                              | Until `expires_at`            | One for each project (`video.completed`). The API shut down on 24 Sep 2026. |
| MiniMax MCP                          | `generate_video` waits up to 10 min, or returns a task id with `async_mode` | A download link               | Not used by the MCP                                                         |
| MCP tasks (2025-11-25, experimental) | `tasks/get`, `tasks/result`                                                 | `ttl`                         | Optional status notification                                                |

OpenCode has no MCP tasks (`opencode/packages/core/src/mcp/`).

## 4. LiteLLM

Sources: `https://docs.litellm.ai/docs/videos`, `/docs/search/`, `/docs/proxy/pass_through_cost_tracking`.

| Fact                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/images/generations`, `/v1/videos`, `/audio/speech`, `/audio/transcriptions` and `/v1/search/<tool>` have cost tracking and fallbacks.                     |
| `/v1/videos` starts a job. The caller polls `GET /v1/videos/{id}`. LiteLLM puts routing data in the ids that it returns.                                    |
| A pass-through target can report its cost in `x-litellm-response-cost`.                                                                                     |
| ren-inference's LiteLLM has one provider key, OpenRouter (`../ren-inference` `packages/litellm/proxy/config.yaml`). Video, speech and search need new keys. |
| The proxy does not use LiteLLM at launch. treg covers the same jobs on one key.                                                                             |
