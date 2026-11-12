import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import type { Models } from "@ren/schema/models"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelsTest } from "./lib/models.js"

const it = testEffect(Layer.empty)

const endpoint = (id: string): Models.CatalogEndpoint => ({
  id,
  protocol: "openai-chat",
  baseUrl: `https://${id}.test/v1`,
  models: [{ id: "chat", type: "chat", protocol: "openai-chat" }],
})

const opened = (storage: Map<string, string>) =>
  Layer.build(Layer.fresh(ModelCatalog.layer.pipe(Layer.provide(ModelsTest.storage(storage))))).pipe(
    Effect.map((services) => Context.get(services, ModelCatalog.Service)),
  )

it.live("the last catalog survives a restart, and the same catalog again writes nothing", () =>
  Effect.gen(function* () {
    const storage = new Map<string, string>()
    const catalog = yield* opened(storage)
    expect(yield* catalog.current).toEqual(Option.none())
    const sent = { endpoints: [endpoint("ren")] }
    expect(yield* catalog.save(sent)).toBe(true)
    expect(yield* catalog.save(sent)).toBe(false)
    expect(yield* (yield* opened(storage)).current).toEqual(Option.some(sent))
  }),
)

it.live("a stored catalog of an older shape is dropped until discovery replaces it", () =>
  Effect.gen(function* () {
    const storage = new Map([["ren:model-catalog", JSON.stringify({ endpoints: [{ id: "ren", models: [] }] })]])
    expect(yield* (yield* opened(storage)).current).toEqual(Option.none())
  }),
)

it.live("each endpoint gets its own provider's key; an endpoint without one is left out", () =>
  Effect.gen(function* () {
    const keys: Readonly<Record<string, string>> = { first: "key-first" }
    const found = yield* ModelCatalog.endpoints({ endpoints: [endpoint("first"), endpoint("second")] }, (id) =>
      Effect.succeed(Option.map(Option.fromNullishOr(keys[id]), (key) => ({ key: Redacted.make(key) }))),
    )
    expect(found.map((each) => [each.id, Redacted.value(each.apiKey.key)])).toEqual([["first", "key-first"]])
  }),
)
