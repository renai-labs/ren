import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { ConfigProvider, DateTime, Duration, Effect, Layer, Redacted } from "effect"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelLists } from "../src/model-lists.js"
import { Models } from "../src/models.js"
import { RenInference } from "../src/ren-inference.js"
import { RenInferenceProvider } from "../src/ren-inference/provider.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Testing.layer)

const catalog: ModelCatalog.Data = {
  providers: [
    {
      id: "upstream-test",
      name: "Upstream",
      models: [
        {
          id: "vendor/model",
          name: "Vendor Model",
          type: "chat",
          tools: true,
          deprecated: false,
          input: ["text"],
          price: { input: 1, output: 2 },
        },
      ],
    },
  ],
}

const gateway = Models.layer(RenInferenceProvider.make).pipe(
  Layer.provide([RenInference.layerNone, ModelLists.layer.pipe(Layer.provide(ModelCatalog.layerFixture(catalog)))]),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        REN_INFERENCE_GATEWAY_URL: "http://gateway.invalid",
        REN_INFERENCE_BRAIN_URL: "http://gateway.brains.invalid",
        REN_INFERENCE_GATEWAY_KEY: "sk-ren",
        REN_MODELS_UPSTREAM: "upstream-test",
      }),
    ),
  ),
)

describe("Models.layer (Providers §7.1)", () => {
  it.live("a pull carries each card with its models and gateway names, at the brains' gateway URL, and no key", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      expect(yield* models.providers(Auth.OrganizationID.create())).toEqual([
        {
          id: "ren",
          name: "Ren",
          protocol: "openai-chat",
          baseUrl: "http://gateway.brains.invalid/v1",
          catalog: {
            models: [
              {
                id: "vendor/model",
                type: "chat",
                name: "Vendor Model",
                input: ["text"],
                protocol: "openai-chat",
                gateway: "ren/vendor/model",
                price: { input: 1, output: 2 },
              },
            ],
          },
        },
      ])
      expect(yield* models.baseUrls).toEqual(["http://gateway.brains.invalid/v1"])
    }).pipe(Effect.provide(gateway)),
  )

  it.live("a grant gives every card the brain's one gateway key", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      const granted = yield* models.grant(Brain.ID.create(), Auth.OrganizationID.create(), Space.ID.create())
      const now = yield* DateTime.now
      const apiKey = granted.endpoints[0]?.apiKey
      expect(granted.endpoints.map((endpoint) => endpoint.id)).toEqual(["ren"])
      expect(apiKey && Redacted.value(apiKey.key)).toBe("sk-ren")
      expect(DateTime.toEpochMillis(apiKey?.expiresAt ?? now) - DateTime.toEpochMillis(now)).toBeWithin(
        Duration.toMillis(RenInferenceProvider.keyLifetime) - 1000,
        Duration.toMillis(RenInferenceProvider.keyLifetime) + 1,
      )
    }).pipe(Effect.provide(gateway)),
  )

  it.live("a Ren without the gateway has no models", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      expect(yield* models.providers(Auth.OrganizationID.create())).toEqual([])
      expect(
        (yield* models.grant(Brain.ID.create(), Auth.OrganizationID.create(), Space.ID.create())).endpoints,
      ).toEqual([])
    }).pipe(Effect.provide(Models.layerNone)),
  )
})
