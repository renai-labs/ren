import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Exit } from "effect"
import { InferencePlugin } from "../src/inference-plugin.js"
import { ModelLists } from "../src/model-lists.js"
import { testEffect } from "./lib/effect.js"
import { TestInferencePlugin } from "./lib/inference-plugin.js"
import { ModelListsTest } from "./lib/model-lists.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const modelIds = (entries: ReadonlyArray<ModelLists.Entry>) =>
  entries.flatMap((entry) => entry.models.map((each) => each.id))

describe("InferencePlugin.registry (Providers §6.1)", () => {
  it.effect("refuses two providers with the same id", () =>
    Effect.gen(function* () {
      const one = yield* TestInferencePlugin.make({ id: "one", providers: [TestInferencePlugin.provider("ren")] })
      const two = yield* TestInferencePlugin.make({ id: "two", providers: [TestInferencePlugin.provider("ren")] })
      const registry = yield* InferencePlugin.registry([Effect.succeed(one.plugin), Effect.succeed(two.plugin)])
      expect(Exit.isFailure(yield* Effect.exit(registry.providers))).toBe(true)
    }),
  )
})

describe("ModelLists (Providers §6.4, P26)", () => {
  it.live("Ren core stores no list: each pull asks the inference service and gets its current models", () =>
    Effect.gen(function* () {
      const test = yield* TestInferencePlugin.make({ providers: [TestInferencePlugin.provider("ren")] })
      const organizationId = yield* Seed.organization()
      yield* Effect.gen(function* () {
        const lists = yield* ModelLists.Service
        yield* test.setModels("ren", { revision: "1", models: [TestInferencePlugin.model("vendor/old")] })
        expect(modelIds(yield* lists.list(organizationId))).toEqual(["vendor/old"])
        yield* test.setModels("ren", { revision: "2", models: [TestInferencePlugin.model("vendor/new")] })
        expect(modelIds(yield* lists.list(organizationId))).toEqual(["vendor/new"])
      }).pipe(Effect.provide(ModelListsTest.layer(test.plugin)))
    }),
  )
})
