import { describe, expect } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { ConfigProvider, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"

const stub = Shared.stub()

const it = testEffect(Layer.empty)

const layer = Models.layerLiteLLM.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        REN_LITELLM_URL: stub.root,
        REN_LITELLM_BRAIN_URL: "http://litellm.brains.invalid",
        REN_LITELLM_KEY: "sk-ren",
      }),
    ),
  ),
)

describe("Models.layerLiteLLM (HR28)", () => {
  it.live("the picker reads the list a brain reads, and each grant names LiteLLM with Ren's key", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      const organizationId = Auth.OrganizationID.create()
      const served = yield* Effect.promise(() => fetch(`${stub.root}/model/info`).then((response) => response.json()))
      expect(yield* models.catalog(organizationId)).toEqual(
        Models.fromLiteLLM(Schema.decodeUnknownSync(Models.LiteLLMModelInfo)(served)),
      )
      expect(stub.modelInfo.reads.at(-1)).toBe("Bearer sk-ren")
      const granted = yield* models.grant(Brain.ID.create(), organizationId, Space.ID.create())
      const now = yield* DateTime.now
      expect(granted.endpoints.map((endpoint) => [endpoint.id, endpoint.baseUrl])).toEqual([
        ["anthropic", "http://litellm.brains.invalid/v1"],
        ["stub", "http://litellm.brains.invalid/v1"],
      ])
      for (const endpoint of granted.endpoints) {
        expect(Redacted.value(endpoint.apiKey.key)).toBe("sk-ren")
        expect(DateTime.toEpochMillis(endpoint.apiKey.expiresAt ?? now) - DateTime.toEpochMillis(now)).toBeWithin(
          Duration.toMillis(Models.keyLifetime) - 1000,
          Duration.toMillis(Models.keyLifetime) + 1,
        )
      }
      expect(yield* models.inference).toEqual(Option.some({ baseUrl: "http://litellm.brains.invalid" }))
    }).pipe(Effect.provide(layer)),
  )

  it.live("LiteLLM down at boot makes the picker unavailable until it answers", () =>
    Effect.gen(function* () {
      stub.modelInfo.down(true)
      yield* Effect.addFinalizer(() => Effect.sync(() => stub.modelInfo.down(false)))
      const models = yield* Effect.provide(Models.Service, layer)
      const organizationId = Auth.OrganizationID.create()
      expect((yield* Effect.flip(models.catalog(organizationId)))._tag).toBe("Models.Unavailable")
      stub.modelInfo.down(false)
      expect((yield* models.catalog(organizationId)).endpoints.map((endpoint) => endpoint.id)).toEqual([
        "anthropic",
        "stub",
      ])
    }),
  )
})
