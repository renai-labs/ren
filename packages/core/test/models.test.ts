import { describe, expect } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { ConfigProvider, DateTime, Duration, Effect, Layer, Redacted, Schema, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { Models } from "../src/models.js"
import { RenInference } from "../src/ren-inference.js"
import { RenInferenceProvider } from "../src/ren-inference/provider.js"
import { testEffect } from "./lib/effect.js"

const stub = Shared.stub()

const it = testEffect(Layer.empty)

const provider = (id: string, baseUrl: string): Models.Provider => ({
  id,
  registration: { id, protocol: "openai-chat", baseUrl, catalog: { models: [] } },
  endpoint: Effect.succeed({ id, protocol: "openai-chat", baseUrl, models: [] }),
  key: () => Effect.succeed({ key: Redacted.make(`key-${id}`) }),
})

const gateway = Models.layer([RenInferenceProvider.make]).pipe(
  Layer.provide([FetchHttpClient.layer, RenInference.layerNone]),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        REN_INFERENCE_GATEWAY_URL: stub.root,
        REN_INFERENCE_BRAIN_URL: "http://gateway.brains.invalid",
        REN_INFERENCE_GATEWAY_KEY: "sk-ren",
      }),
    ),
  ),
)

describe("Models.layer", () => {
  it.live("a catalog outage does not block provider registration or the brain's discovery key", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      expect((yield* models.providers).map((provider) => provider.id)).toEqual(["first"])
      expect(
        (yield* models.grant(Brain.ID.create(), Auth.OrganizationID.create(), Space.ID.create())).endpoints.map(
          (endpoint) => Redacted.value(endpoint.apiKey.key),
        ),
      ).toEqual(["key-first"])
      expect((yield* Effect.flip(models.catalog(Auth.OrganizationID.create())))._tag).toBe("Models.Unavailable")
    }).pipe(
      Effect.provide(
        Models.layer([
          Effect.succeed({
            ...provider("first", "https://first.test/v1"),
            endpoint: Effect.fail(new Models.Unavailable({ cause: new Error("catalog is down") })),
          }),
        ]),
      ),
    ),
  )
  it.live("each provider's endpoint gets that provider's own key", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      const granted = yield* models.grant(Brain.ID.create(), Auth.OrganizationID.create(), Space.ID.create())
      expect(granted.endpoints.map((endpoint) => [endpoint.id, Redacted.value(endpoint.apiKey.key)])).toEqual([
        ["first", "key-first"],
        ["second", "key-second"],
      ])
    }).pipe(
      Effect.provide(
        Models.layer([
          Effect.succeed(provider("first", "https://first.test/v1")),
          Effect.succeed(provider("second", "https://second.test/v1")),
        ]),
      ),
    ),
  )

  it.live("two providers with one id do not start", () =>
    Effect.gen(function* () {
      const exit = yield* Layer.build(
        Models.layer([
          Effect.succeed(provider("same", "https://first.test/v1")),
          Effect.succeed(provider("same", "https://second.test/v1")),
        ]),
      ).pipe(Effect.scoped, Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )
})

describe("RenInferenceProvider (HR28)", () => {
  it.live("Ren registers one endpoint with its name, models, search and the brains' base URL, and Ren's key", () =>
    Effect.gen(function* () {
      stub.modelInfo.search([{ id: "ren/search", name: "Search" }])
      yield* Effect.addFinalizer(() => Effect.sync(() => stub.modelInfo.search([])))
      const models = yield* Effect.provide(Models.Service, gateway)
      const organizationId = Auth.OrganizationID.create()
      const catalog = yield* models.catalog(organizationId)
      expect(catalog.endpoints.map((endpoint) => Struct.omit(endpoint, ["models"]))).toEqual([
        {
          id: "ren",
          name: "Ren",
          protocol: "openai-chat",
          baseUrl: "http://gateway.brains.invalid/v1",
          search: [{ id: "ren/search", name: "Search" }],
        },
      ])
      expect(catalog.endpoints[0]?.models.map((model) => model.id)).toContain("stub/stub-model")
      expect(stub.modelInfo.reads.slice(-2)).toEqual(["Bearer sk-ren", "Bearer sk-ren"])
      const granted = yield* models.grant(Brain.ID.create(), organizationId, Space.ID.create())
      const now = yield* DateTime.now
      expect(Models.catalog(granted).endpoints.map((endpoint) => [endpoint.id, endpoint.baseUrl])).toEqual([
        ["ren", "http://gateway.brains.invalid/v1"],
      ])
      expect(yield* models.providers).toEqual([
        {
          id: "ren",
          name: "Ren",
          protocol: "openai-chat",
          baseUrl: "http://gateway.brains.invalid/v1",
          catalog: "inference",
        },
      ])
      const apiKey = granted.endpoints[0]?.apiKey
      expect(apiKey && Redacted.value(apiKey.key)).toBe("sk-ren")
      expect(Object.keys(apiKey ?? {}).toSorted()).toEqual(["expiresAt", "key"])
      expect(DateTime.toEpochMillis(apiKey?.expiresAt ?? now) - DateTime.toEpochMillis(now)).toBeWithin(
        Duration.toMillis(RenInferenceProvider.keyLifetime) - 1000,
        Duration.toMillis(RenInferenceProvider.keyLifetime) + 1,
      )
    }),
  )

  it.live("the gateway down at boot makes the catalog unavailable until it answers", () =>
    Effect.gen(function* () {
      stub.modelInfo.down(true)
      yield* Effect.addFinalizer(() => Effect.sync(() => stub.modelInfo.down(false)))
      const models = yield* Effect.provide(Models.Service, gateway)
      const organizationId = Auth.OrganizationID.create()
      expect((yield* Effect.flip(models.catalog(organizationId)))._tag).toBe("Models.Unavailable")
      stub.modelInfo.down(false)
      expect((yield* models.catalog(organizationId)).endpoints.map((endpoint) => endpoint.id)).toEqual(["ren"])
    }),
  )

  it.live("the inference catalog needs each model's native type and protocol", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownSync(Models.InferenceCatalog)
      const baseUrl = "https://execution.example/v1"
      expect(
        decode({ baseUrl, models: [{ id: "opaque-image", type: "image", protocol: "openai-images", modelID: "x" }] }),
      ).toEqual({ baseUrl, models: [{ id: "opaque-image", type: "image", protocol: "openai-images" }] })
      expect(() =>
        decode({ baseUrl, models: [{ id: "x", type: "image_generation", protocol: "openai-images" }] }),
      ).toThrow()
      expect(() => decode({ baseUrl, models: [{ id: "x", type: "chat" }] })).toThrow()
    }),
  )
})
