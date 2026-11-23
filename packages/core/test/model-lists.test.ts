import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Exit, Layer } from "effect"
import { ModelGateway } from "../src/model-gateway.js"
import { ModelLists } from "../src/model-lists.js"
import { testEffect } from "./lib/effect.js"
import { TestModelGateway } from "./lib/model-gateway.js"
import { ModelListsTest } from "./lib/model-lists.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const modelIds = (entries: ReadonlyArray<ModelLists.Entry>) =>
  entries.flatMap((entry) => entry.models.map((each) => each.id))

describe("ModelGateway.registry (Providers §6.1)", () => {
  it.effect("refuses two providers with the same id", () =>
    Effect.gen(function* () {
      const one = yield* TestModelGateway.make({ id: "one", providers: [TestModelGateway.provider("ren")] })
      const two = yield* TestModelGateway.make({ id: "two", providers: [TestModelGateway.provider("ren")] })
      const registry = yield* ModelGateway.registry([Effect.succeed(one.gateway), Effect.succeed(two.gateway)])
      expect(Exit.isFailure(yield* Effect.exit(registry.providers))).toBe(true)
    }),
  )
})

describe("ModelLists (Providers §6.4, P26)", () => {
  it.live("Ren core stores no list: each pull asks the gateway and gets its current models", () =>
    Effect.gen(function* () {
      const test = yield* TestModelGateway.make({ providers: [TestModelGateway.provider("ren")] })
      const organizationId = yield* Seed.organization()
      yield* Effect.gen(function* () {
        const lists = yield* ModelLists.Service
        yield* test.setModels("ren", { revision: "1", models: [TestModelGateway.model("vendor/old")] })
        expect(modelIds(yield* lists.list(organizationId))).toEqual(["vendor/old"])
        yield* test.setModels("ren", { revision: "2", models: [TestModelGateway.model("vendor/new")] })
        expect(modelIds(yield* lists.list(organizationId))).toEqual(["vendor/new"])
      }).pipe(Effect.provide(ModelListsTest.layer(test.gateway)))
    }),
  )

  it.live("a change for one organization notifies only that organization", () =>
    Effect.gen(function* () {
      const listener = yield* ModelListsTest.listening
      const test = yield* TestModelGateway.make({
        providers: [TestModelGateway.provider("seats", { models: "organization" })],
      })
      const first = yield* Seed.organization()
      yield* Seed.organization()
      yield* Effect.gen(function* () {
        const lists = yield* ModelLists.Service
        yield* listener.collect
        yield* lists.changed({ provider: "seats", organizationId: first })
        expect(yield* listener.collect).toEqual([`org:${first}`])
      }).pipe(Effect.provide(ModelListsTest.layer(test.gateway)))
    }),
  )

  it.live("a change for every organization notifies only those the gateway names, never 'all'", () =>
    Effect.gen(function* () {
      const listener = yield* ModelListsTest.listening
      const test = yield* TestModelGateway.make({ providers: [TestModelGateway.provider("ren")] })
      const on = yield* Seed.organization()
      yield* Seed.organization()
      yield* test.setOrganizations("ren", [on])
      yield* Effect.gen(function* () {
        yield* listener.collect
        yield* ModelLists.Service.use((lists) => lists.changed({ provider: "ren" }))
        expect(yield* listener.collect).toEqual([`org:${on}`])
      }).pipe(Effect.provide(ModelListsTest.layer(test.gateway)))
    }),
  )

  it.live("a gateway's `changed` reaches the organization's brains", () =>
    Effect.gen(function* () {
      const listener = yield* ModelListsTest.listening
      const test = yield* TestModelGateway.make({
        providers: [TestModelGateway.provider("seats", { models: "organization" })],
      })
      const organizationId = yield* Seed.organization()
      yield* Effect.gen(function* () {
        yield* listener.collect
        yield* test.setModels(
          "seats",
          { revision: "2", models: [TestModelGateway.model("vendor/seat")] },
          organizationId,
        )
        yield* listener.awaitPayload(`org:${organizationId}`)
      }).pipe(Effect.provide(ModelLists.layerJob.pipe(Layer.provideMerge(ModelListsTest.layer(test.gateway)))))
    }),
  )
})
