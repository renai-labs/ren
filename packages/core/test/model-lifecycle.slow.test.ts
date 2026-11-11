import { describe, expect, setDefaultTimeout } from "bun:test"
import { StubModel } from "@ren/cell/testing"
import { Effect } from "effect"
import { testEffect } from "./lib/effect.js"
import { ModelSource } from "./lib/model-source.js"

setDefaultTimeout(60_000)

const it = testEffect(ModelSource.layer)

describe("models on a brain, from the inference service (HR14, HR16)", () => {
  it.live("a model added in the gateway can be chosen by the next start: the brain reads the list again first", () =>
    Effect.gen(function* () {
      const opened = yield* ModelSource.chat(ModelSource.access({ stub: ModelSource.lasting("sk-stub") }))
      ModelSource.stub.modelInfo.set([...StubModel.defaultModels, StubModel.modelEntry("later", "stub-model")])
      yield* Effect.addFinalizer(() => Effect.sync(() => ModelSource.stub.modelInfo.set(StubModel.defaultModels)))
      ModelSource.source.access = ModelSource.access({
        stub: ModelSource.lasting("sk-stub"),
        later: ModelSource.lasting("sk-later"),
      })
      const script = ModelSource.stub.script()
      yield* opened.restart({ model: { endpointId: "later", modelId: "stub-model" } }, `later ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-later")
    }),
  )

  it.live("an inference URL moved on Ren reaches the next turn, with the brain's key", () =>
    Effect.gen(function* () {
      const key = ModelSource.lasting("sk-stub")
      const opened = yield* ModelSource.chat(ModelSource.access({ stub: key }))
      ModelSource.source.access = ModelSource.access({ stub: key }, ModelSource.stub.url.replace(/\/v1$/u, "/moved/v1"))
      const script = ModelSource.stub.script()
      yield* opened.restart({}, `moved ${script.marker}`)
      const call = yield* Effect.promise(() => script.called())
      expect([call.path, call.authorization]).toEqual(["/moved/v1/chat/completions", "Bearer sk-stub"])
    }),
  )
})
