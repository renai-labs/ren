# Piece F: model source from config

Status: spec written. Decisions: E9, E23, E28, E54–E64 (README §6).

## Goal

A real model answers in a chat before the LiteLLM port (piece H). Model changes reach running brains without a restart. Every mechanism here also serves LiteLLM: piece H replaces only the `Models` layer.

## Model names and endpoints (E56)

| Field                                    | Value                                                   | Use                                               |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `Endpoint.id`                            | provider group: `anthropic`, `openai`, `openrouter`     | stored choices, OpenCode provider id              |
| `Endpoint.protocol`                      | `anthropic-messages`, `openai-responses`, `openai-chat` | which client OpenCode uses                        |
| `Models.Info.id`                         | Ren's stable name: `claude-sonnet-5-5`                  | stored choices, settings, picker                  |
| `Models.Info.upstreamId` (new, optional) | proxy name: `anthropic/claude-sonnet-5-5`               | sent upstream; the brain sends `upstreamId ?? id` |

Stored choices keep `{ endpointId, modelId, variant }` (E59). `core/ren/settings.json` (`anthropic` / `claude-sonnet-5-5`) works unchanged.

Example `REN_MODELS_FILE`, with the key replaced:

```json
{
  "endpoints": [
    {
      "id": "anthropic",
      "protocol": "anthropic-messages",
      "baseUrl": "https://litellm.example.com/v1",
      "apiKey": { "key": "<key>" },
      "models": [
        {
          "id": "claude-sonnet-5-5",
          "upstreamId": "anthropic/claude-sonnet-5-5",
          "name": "Claude Sonnet 5.5",
          "efforts": ["medium", "low", "high"]
        },
        { "id": "claude-haiku-5-5", "upstreamId": "anthropic/claude-haiku-5-5", "name": "Claude Haiku 5.5" }
      ]
    },
    {
      "id": "openai",
      "protocol": "openai-responses",
      "baseUrl": "https://litellm.example.com/v1",
      "apiKey": { "key": "<key>" },
      "models": [{ "id": "gpt-6.1-sol", "upstreamId": "openai/gpt-6.1-sol", "name": "GPT-6.1 Sol" }]
    }
  ]
}
```

Do not print or commit the key (README §7).

## Service and layers (E54)

```ts
export interface Interface {
  readonly catalog: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Catalog, Unavailable>
  readonly grant: (brainId: Brain.ID, organizationId: Auth.OrganizationID) => Effect.Effect<Models.Access, Unavailable>
}
```

`refreshIfDue` and `revoke` are removed: renewal is time-based on the brain (E57), and nothing revokes a config key.

| Layer         | `catalog`                          | `grant`                                                                |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `layerNone`   | no endpoints                       | no endpoints                                                           |
| `layerConfig` | the file's endpoints, without keys | the file's endpoints; each `apiKey.expiresAt` = grant time + 6 h (E57) |

`layerConfig` (E63):

- It reads `REN_MODELS_FILE` at boot, and stops Ren if the file is missing or not a valid `Models.Access`.
- It watches the file. A valid change replaces the copy in memory. An invalid change keeps the last valid copy and logs an error.
- `server/src/main.ts` uses `layerConfig` instead of `layerNone`.

## Hot reload of models

| Change                                                                        | Path                                                                                                               | A running chat gets it |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| catalog (endpoints, models, `upstreamId`, efforts, limits, base URL, headers) | `/host/pull` models hash (E28). The hash covers everything except keys.                                            | at turn end (E64)      |
| key                                                                           | `models.refresh` when 3 h are left (E57); at once on a 401, one renewal and one retry (E58); dropped on wake (E38) | at once                |
| layer default model                                                           | settings layer hash in `/host/pull`                                                                                | at turn end            |

**Brain side (E64):**

- Each Location holds its own model list. At turn end the plugin installs the latest list and reloads `provider` and `integration` for that Location only.
- `Credentials.sync` adds and updates credentials at once.
- It removes a credential only when no Location still has that endpoint installed.

## Resolution rules

| Case                                        | Result                                                                    | Decision |
| ------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| the chat's pick is not available            | clear the pick; add a synthetic message naming the old and the new model  | E55      |
| a layer's model is not available            | use the next layer: chat → agent → space → organization → Ren             | E61      |
| a subagent's model is not available         | use the primary's model                                                   | E61      |
| no layer names an available model           | settings fail: "no available model is set"                                | E61      |
| the stored variant is not offered           | use `efforts[0]`                                                          | E62      |
| the brain has no access, or its key expired | `ModelsNotConfigured`: the brain pulls at once and answers after the pull | E60      |

## Contract changes

| Package    | Change                                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`   | `Models.Info.upstreamId: Schema.optionalKey(Schema.NonEmptyString)`.                                                                                                                                           |
| `core`     | `Models.Interface` as above. `layerConfig`. `Session.create` and `Session.models` call `catalog(organizationId)`. `BrainHost` no longer calls `refreshIfDue`, `grant` or `revoke` around start and send (E23). |
| `host-api` | `models.refresh` returns the brain's current grant (`grant(brainId, …)`).                                                                                                                                      |
| `cell`     | `ModelProviders.apply` sends `upstreamId ?? id`. Model list per Location (E64). `ModelRefresh` window 3 h (E57). 401 renewal and retry (E58). `ModelsNotConfigured` triggers a pull (E60).                     |
| `brain`    | `BrainSettings.resolve` skips unavailable models by layer (E61) and replaces unknown variants (E62), instead of failing in `checkModel`.                                                                       |

## Lifecycle states

| State               | What happens                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| asleep, then waking | The wake drops cached keys and pulls (E38): the first model call uses a key fetched after the wake (ren-v1 INV-29).                                                                                                                                                                                         |
| restarting (brain)  | The model access and keys come from `brain.db`. An expired key gives `ModelsNotConfigured`, then a pull (E60).                                                                                                                                                                                              |
| down (Ren)          | The brain keeps its list and keys. Renewal starts when 3 h are left (E57), so the brain survives a Ren outage of 3 h to 6 h, depending on when it starts. After that, the key counts as expired: new turns wait for Ren, and a running turn fails at its next model call. LiteLLM keys behave the same way. |
| mid-turn            | Catalog changes wait for turn end. Keys can change during the turn.                                                                                                                                                                                                                                         |
| Ren restart         | `layerConfig` reads the file again; brains get any change within 30 s.                                                                                                                                                                                                                                      |

## Limits until piece H

- All spend goes to one key. There is no per-user or per-organization number.
- Budget errors (402) show the provider's text.
- Inside a sandbox, an agent can read the key (E8).

## Tests

Write each test first. Each test must fail before its change.

| #   | Package and file                             | Test                                                                                                                                                                         |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `core/test/models.test.ts`                   | A missing or invalid `REN_MODELS_FILE` stops the layer at boot. A later invalid write keeps the last valid copy. A valid write changes `catalog` and `grant`.                |
| 2   | `core/test/models.test.ts`                   | `grant` gives every key an expiry 6 h after the grant. `catalog` carries no key.                                                                                             |
| 3   | `core/test/settings.test.ts`                 | The `/host/pull` models hash does not change when only a key changes, and changes when a model or an `upstreamId` changes.                                                   |
| 4   | `cell/test/credentials.test.ts`              | Removing an endpoint keeps its credential while a busy Location still has it, and removes it after that Location's turn ends.                                                |
| 5   | `cell/test/model-refresh.test.ts`            | A key is renewed when 3 h are left. A 401 renews once and retries once. A second 401 fails the turn.                                                                         |
| 6   | `cell/test/settings.test.ts`                 | A catalog change during a busy turn installs at turn end, for that Location only.                                                                                            |
| 7   | `brain/test/settings.test.ts`                | An unavailable agent model falls back to the space's model. An unavailable subagent model falls back to the primary's. No available model gives "no available model is set". |
| 8   | `brain/test/settings.test.ts`                | An unknown variant becomes `efforts[0]`.                                                                                                                                     |
| 9   | `cell/test/brain-api.test.ts`                | A brain started while Ren is down answers `ModelsNotConfigured`. When Ren is back, it pulls and the next `send` succeeds (ren-v1 OI-5).                                      |
| 10  | `cell/test/tool-parity.test.ts` (stub model) | The upstream request carries `upstreamId`, not `id`.                                                                                                                         |
| 11  | live, skipped without the key                | A turn on `claude-sonnet-5-5` through the proxy returns text.                                                                                                                |
