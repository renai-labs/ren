# Specifications

This folder holds only work that is not built: designs being discussed, and the pending part of features that are partly built. Remove a spec, or the part of it that ships, in the same change that builds it. Git history keeps removed specs.

## Authority

Built behavior is in the code, not here:

| Concern                              | Owner                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| HTTP operations and transport errors | [Protocol](../packages/protocol/src) endpoint definitions               |
| Domain shapes and durable payloads   | [Schema](../packages/schema/src)                                        |
| Runtime behavior and persistence     | [Core](../packages/core/src) and [DB](../packages/db/src)               |
| Access rules                         | `core/src/*/policy.ts`; `bun core/script/print-policies.ts` prints them |
| Contributor-critical guardrails      | Root [AGENTS.md](../AGENTS.md) and nested `AGENTS.md` files             |

Generated clients follow the protocol `HttpApi`.

## Index

| Spec                                                                 | Pending                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [app-connections.md](app-connections.md)                             | One Add app sheet, app status, account rules (last space, Use here, unique names), seed data                                    |
| [app/spaces.md](app/spaces.md)                                       | Inbox usage, task-card review actions, the chat panel on `FileSystem`, search across spaces                                     |
| [tasks.md](tasks.md)                                                 | Handoff to the next agent, drag and drop, review start as a flag, dashboard                                                     |
| [chat-list.md](chat-list.md)                                         | The app's chat filters, webhook chats, stable pages, search at scale                                                            |
| [cli.md](cli.md)                                                     | `ren2 api`, connection profiles, device login, chat and streaming                                                               |
| [infra.md](infra.md)                                                 | Apply of webhooks, environments and timezones; listings                                                                         |
| [usage.md](usage.md)                                                 | The billing check, reconciliation, an automated usage e2e case, the PostHog and billing loops, cleanup of finished durable runs |
| [runtime/README.md](runtime/README.md)                               | The `FeatureFlags` service and the flag list                                                                                    |
| [runtime/artifact-hosting.md](runtime/artifact-hosting.md)           | Artifacts in the app, user-supplied providers                                                                                   |
| [runtime/artifact-refactor.md](runtime/artifact-refactor.md)         | Deployment table, async stop and archive, results to the chat, provider state in Postgres, Cloudflare direct upload             |
| [runtime/artifact-sites.md](runtime/artifact-sites.md)               | Workers for Platforms and `<label>.useren.site`, stacked on the refactor                                                        |
| [runtime/artifact-names.md](runtime/artifact-names.md)               | Names for artifacts (`<name>.useren.site`), stacked on artifact sites                                                           |
| [runtime/e2b-brain/README.md](runtime/e2b-brain/README.md)           | Harness-neutral sync, restore leftovers, live E2B tests, retries                                                                |
| [runtime/opencode-upgrade.md](runtime/opencode-upgrade.md)           | The OpenCode boundary and bump command, then the 2.2.6 upgrade                                                                  |
| [runtime/hot-reload/README.md](runtime/hot-reload/README.md)         | Tests not written, a model key per brain                                                                                        |
| [runtime/media-models.md](runtime/media-models.md)                   | Native gateway provider and typed catalogs, OpenCode's image tool, then speech, voice, video and bring your own key             |
| [runtime/channels/README.md](runtime/channels/README.md)             | Linear, Slack task card and onboarding, GitHub live checks                                                                      |
| [runtime/credentials/README.md](runtime/credentials/README.md)       | `oauth-session.complete`, KMS, traffic the egress cannot inject                                                                 |
| [runtime/private-spaces/README.md](runtime/private-spaces/README.md) | Usage totals, files spec alignment                                                                                              |
| [runtime/files/README.md](runtime/files/README.md)                   | Chat uploads and outputs on drives, cards, viewer, Files panel, mount fixes                                                     |
