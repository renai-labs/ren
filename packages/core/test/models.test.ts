import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { Duration, Effect, Exit, Fiber, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { ModelLists } from "../src/model-lists.js"
import { InferencePlugin } from "../src/inference-plugin.js"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"
import { TestInferencePlugin } from "./lib/inference-plugin.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

// oxlint-disable-next-line ren/no-comments -- Models over one test inference plugin and the real lists, in the test database.
const withPlugin = (test: { readonly plugin: InferencePlugin.Plugin }) =>
  Models.layer.pipe(
    Layer.provideMerge(ModelLists.layer),
    Layer.provideMerge(InferencePlugin.layer([Effect.succeed(test.plugin)])),
  )

const brainIn = (organizationId: Auth.OrganizationID) => [Brain.ID.create(), organizationId, Space.ID.create()] as const

const keyOf = (access: Models.Access) => access.endpoints.map((endpoint) => Redacted.value(endpoint.apiKey.key))

describe("Models.layer (Providers §6.1, §7.1)", () => {
  it.effect(
    "a pull carries each provider that needs no connection, at its inference plugin's address, without a key",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInferencePlugin.make({
          providers: [
            TestInferencePlugin.provider("ren", { name: "Ren" }),
            TestInferencePlugin.provider("groq", { auth: [{ _tag: "key", fields: [] }] }),
          ],
        })
        yield* test.setModels("ren", { revision: "1", models: [TestInferencePlugin.model("vendor/model")] })
        const organizationId = yield* Seed.organization()
        const providers = yield* Models.Service.use((models) => models.providers(organizationId)).pipe(
          Effect.provide(withPlugin(test)),
        )
        expect(providers).toEqual([
          {
            id: "ren",
            name: "Ren",
            protocol: "openai-chat",
            baseUrl: "https://models.test/v1",
            catalog: { models: [TestInferencePlugin.model("vendor/model")] },
          },
        ])
      }),
  )

  it.effect("a minted key is kept until 20 minutes before it expires, then the inference service is asked again", () =>
    Effect.gen(function* () {
      const test = yield* TestInferencePlugin.make({ providers: [TestInferencePlugin.provider("ren")] })
      const organizationId = yield* Seed.organization()
      const brain = brainIn(organizationId)
      yield* Effect.gen(function* () {
        const models = yield* Models.Service
        const first = keyOf(yield* models.grant(...brain))
        yield* TestClock.adjust(Duration.minutes(5 * 60 + 39))
        expect(keyOf(yield* models.grant(...brain))).toEqual(first)
        expect((yield* test.calls).grants).toBe(1)
        yield* TestClock.adjust(Duration.minutes(2))
        yield* models.grant(...brain)
        expect((yield* test.calls).grants).toBe(2)
      }).pipe(Effect.provide(withPlugin(test)))
    }),
  )

  it.effect("a fixed key is kept until a call answers 401, then the inference service is asked again", () =>
    Effect.gen(function* () {
      const test = yield* TestInferencePlugin.make({ providers: [TestInferencePlugin.provider("ren")], fixed: true })
      const organizationId = yield* Seed.organization()
      const brain = brainIn(organizationId)
      yield* Effect.gen(function* () {
        const models = yield* Models.Service
        yield* models.grant(...brain)
        yield* TestClock.adjust(Duration.days(30))
        yield* models.grant(...brain)
        expect((yield* test.calls).grants).toBe(1)
        yield* models.forgetKey(...brain, test.plugin.id)
        yield* models.grant(...brain)
        expect((yield* test.calls).grants).toBe(2)
      }).pipe(Effect.provide(withPlugin(test)))
    }),
  )

  it.effect("a brain's keys do not wait for the model list: they answer while the inference service's lists fail", () =>
    Effect.gen(function* () {
      const test = yield* TestInferencePlugin.make({ providers: [TestInferencePlugin.provider("ren")] })
      const organizationId = yield* Seed.organization()
      const brain = brainIn(organizationId)
      yield* test.setListsDown(true)
      yield* Effect.gen(function* () {
        const models = yield* Models.Service
        expect(Exit.isFailure(yield* Effect.exit(models.catalog(organizationId)))).toBe(true)
        const keys = yield* models.keys(...brain)
        expect(keys.map((key) => [key.plugin, key.baseUrl])).toEqual([[test.plugin.id, test.plugin.baseUrl]])
      }).pipe(Effect.provide(withPlugin(test)))
    }),
  )

  it.effect("two grants for one brain at once ask the inference service once", () =>
    Effect.gen(function* () {
      const test = yield* TestInferencePlugin.make({ providers: [TestInferencePlugin.provider("ren")] })
      const organizationId = yield* Seed.organization()
      const brain = brainIn(organizationId)
      yield* Effect.gen(function* () {
        const models = yield* Models.Service
        const first = yield* Effect.forkChild(models.grant(...brain))
        const second = yield* Effect.forkChild(models.grant(...brain))
        expect(keyOf(yield* Fiber.join(first))).toEqual(keyOf(yield* Fiber.join(second)))
        expect((yield* test.calls).grants).toBe(1)
      }).pipe(Effect.provide(withPlugin(test)))
    }),
  )

  it.effect("a change in a provider's models changes the list and mints no key", () =>
    Effect.gen(function* () {
      const test = yield* TestInferencePlugin.make({ providers: [TestInferencePlugin.provider("ren")] })
      const organizationId = yield* Seed.organization()
      const brain = brainIn(organizationId)
      yield* Effect.gen(function* () {
        const models = yield* Models.Service
        yield* models.grant(...brain)
        yield* test.setModels("ren", { revision: "2", models: [TestInferencePlugin.model("vendor/new")] })
        const after = yield* models.grant(...brain)
        expect(after.endpoints.flatMap((endpoint) => endpoint.models.map((each) => each.id))).toEqual(["vendor/new"])
        expect((yield* test.calls).grants).toBe(1)
      }).pipe(Effect.provide(withPlugin(test)))
    }),
  )

  it.effect("a Ren without inference plugins has no models", () =>
    Effect.gen(function* () {
      const organizationId = yield* Seed.organization()
      const models = yield* Models.Service
      expect(yield* models.providers(organizationId)).toEqual([])
      expect(yield* models.grant(...brainIn(organizationId))).toEqual({ endpoints: [] })
    }).pipe(Effect.provide(Models.layerNone)),
  )
})
