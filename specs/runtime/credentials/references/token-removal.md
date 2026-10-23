# Token code that this spec removes

Evidence for [`../README.md`](../README.md), decision C19. Do this after M2 of [`../../e2b-brain`](../../e2b-brain/README.md). Line numbers are at commit `8a302f452`; M2 work can move them.

## Lifetimes today

| Token or key      | Lifetime                                                 | Renewed by                                                                              | Real lifetime?                                                                                                                            |
| ----------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Server token      | 5 min (`host-api/src/brain-token.ts:52`)                 | Ren signs one per call                                                                  | yes                                                                                                                                       |
| Client token      | 1 h (same line)                                          | the app asks for access again                                                           | yes                                                                                                                                       |
| Host token        | 2 h (same line; signed at `core/src/brain-client.ts:63`) | the brain, when 1 h is left (`cell/src/host-token.ts:11`), with the current token       | yes                                                                                                                                       |
| Environment token | 15 min (`core/src/environments.ts:100`)                  | the brain, 5 min early (`brain/src/environment/connections.ts:45`), with the host token | yes                                                                                                                                       |
| Model key         | "6 h" (`core/src/models.ts:34`)                          | the brain, when 3 h are left (`cell/src/model-refresh.ts:11`), with the host token      | no: `Models.grant` writes `expiresAt` next to a static key (`core/src/models.ts:93-99`). After piece H, a LiteLLM key with a real expiry. |

The host token is the root: host, environment and model renewals all present it. When it expires, all three stop until Ren calls the brain.

## Code

| Code                                                                                                                                                             | After this spec                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `cell/src/host-token.ts` (82 lines)                                                                                                                              | goes. The egress injects the host token.       |
| `cell/src/model-refresh.ts` (70 lines)                                                                                                                           | goes. Ren refreshes model keys.                |
| `cell/src/model-store.ts`: `readHostToken`, `writeHostTokenIfUnchanged`, `keepHostToken`, `removeHostTokenIfUnchanged` (`:18-27`), and the keys in stored access | goes. The model list stays.                    |
| `cell/src/harness/opencode/credentials.ts`, `model-credentials.ts`; the store update in `server.ts:136`; the `ren` refresh method in `plugin.ts:265-272`         | goes. OpenCode gets a placeholder key.         |
| The 401 renew-and-retry in `plugin.ts:378`                                                                                                                       | goes.                                          |
| The host-token check in `cell/src/brain.ts:37`                                                                                                                   | goes.                                          |
| `cell/src/fence.ts`, and its use in `host-token.ts:71` and `hot-reload.ts:110`                                                                                   | optional. The egress denies an old generation. |
| The environment token for a brain's own hand; `cell/src/host-access.ts` for that hand                                                                            | goes. The call stays on 127.0.0.1.             |
| `server/src/handlers/ren-host/token.ts` (`host.refresh`), `models.ts` (`models.refresh`)                                                                         | go.                                            |
| `core/src/brain-client.ts:45`, `core/src/environments.ts:99` (read private keys)                                                                                 | use `Signer`.                                  |

## Runtime decisions

Decisions are in [`../../e2b-brain/README.md`](../../e2b-brain/README.md) §6.

| Decision | Today                                                           | After this spec                                                |
| -------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| E25      | One host token per brain, held by the brain.                    | The egress holds it and injects it (C8).                       |
| E47      | The brain renews its host token at 1 h left.                    | Ren signs a new one 5 min before `exp`; the egress caches it.  |
| E54, E57 | Model grants with keys in the brain; renewal at 3 h left.       | The model key is a credential at the egress.                   |
| E58      | Renew the key once on a 401, then retry.                        | Removed.                                                       |
| E60      | On `ModelsNotConfigured`, pull and answer again.                | Only for the model list.                                       |
| E64      | Model credentials installed per Location.                       | Model list only; no credentials.                               |
| E69      | The boot poll carries the first host token in `ren-host-token`. | Removed.                                                       |
| E97      | Environment token for the brain's own hand.                     | Removed for its own hand.                                      |
| E119     | The brain learns Ren's address from server tokens.              | Removed. The brain calls `ren.internal`; the egress routes it. |
| E51      | The brain fences itself on `GenerationRetired`.                 | Optional; the egress denies the old generation.                |
