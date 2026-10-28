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

| Spec                                                                 | Pending                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [tasks.md](tasks.md)                                                 | Handoff to the next agent, drag and drop, review start as a flag, dashboard |
| [cli.md](cli.md)                                                     | `ren2 api`, connection profiles, device login, chat and streaming           |
| [infra.md](infra.md)                                                 | Apply of webhooks, environments and timezones; listings                     |
| [runtime/README.md](runtime/README.md)                               | The `FeatureFlags` service and the flag list                                |
| [runtime/e2b-brain/README.md](runtime/e2b-brain/README.md)           | Harness-neutral sync, restore leftovers, live E2B tests, retries            |
| [runtime/hot-reload/README.md](runtime/hot-reload/README.md)         | Tests not written, a model key per brain                                    |
| [runtime/channels/README.md](runtime/channels/README.md)             | Linear, Slack task card and onboarding, GitHub live checks                  |
| [runtime/credentials/README.md](runtime/credentials/README.md)       | `oauth-session.complete`, KMS, traffic the egress cannot inject             |
| [runtime/private-spaces/README.md](runtime/private-spaces/README.md) | Usage totals, files spec alignment                                          |
