import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import type { Models } from "@ren/schema/models"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { OpenCodeModels } from "../src/harness/opencode/models.js"
import { Inference } from "../src/inference.js"
import { ModelsTest } from "./lib/models.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"

const it = testEffect(Layer.empty)

const stub = Shared.stub()

const reader = Effect.gen(function* () {
  const inference = Context.get(
    yield* Layer.build(Inference.layer.pipe(Layer.provide(ModelsTest.storage()))),
    Inference.Service,
  )
  yield* inference.saveBaseUrl(Option.some(stub.root))
  const applied: Array<ReadonlyArray<string>> = []
  const models = yield* OpenCodeModels.make({
    inference,
    keyFor: () => Effect.succeed(Option.some({ key: Redacted.make("stub-key") })),
    apply: (endpoints: ReadonlyArray<Models.Endpoint>) =>
      Effect.sync(() => {
        applied.push(endpoints.flatMap((endpoint) => endpoint.models.map((model) => `${endpoint.id}/${model.id}`)))
      }),
  }).pipe(Effect.provide(FetchHttpClient.layer))
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stub.modelInfo.down(false)
      stub.modelInfo.set(StubModel.defaultModels)
    }),
  )
  return { inference, refresh: models.refresh, applied }
})

it.live("LiteLLM down at boot leaves the brain without a list until it answers, then the list arrives (test 34)", () =>
  Effect.gen(function* () {
    stub.modelInfo.down(true)
    const opened = yield* reader
    yield* opened.refresh
    expect(yield* opened.inference.catalog).toEqual(Option.none())
    stub.modelInfo.down(false)
    yield* opened.refresh
    expect(Option.map(yield* opened.inference.catalog, (catalog) => catalog.endpoints.map((each) => each.id))).toEqual(
      Option.some(["anthropic", "stub"]),
    )
  }),
)

it.live("LiteLLM down after a read keeps the last list: models do not go and come back (test 35)", () =>
  Effect.gen(function* () {
    const opened = yield* reader
    yield* opened.refresh
    const first = opened.applied.length
    const stored = yield* opened.inference.catalog
    stub.modelInfo.down(true)
    yield* opened.refresh
    expect(opened.applied).toHaveLength(first)
    expect(yield* opened.inference.catalog).toEqual(stored)
    stub.modelInfo.set([...StubModel.defaultModels, StubModel.modelEntry("stub", "stub-new")])
    stub.modelInfo.down(false)
    yield* opened.refresh
    expect(opened.applied.at(-1)).toContain("stub/stub-new")
  }),
)
