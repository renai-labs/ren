import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "./lib/effect.js"
import { ModelSource } from "./lib/model-source.js"

setDefaultTimeout(60_000)

const it = testEffect(ModelSource.layer)

describe("models on a brain, through the pull", () => {
  it.live("an endpoint added on Ren can be chosen by the next start, whose pull brings it", () =>
    Effect.gen(function* () {
      const opened = yield* ModelSource.chat(ModelSource.access({ stub: ModelSource.lasting("sk-stub") }))
      ModelSource.source.access = ModelSource.access({
        stub: ModelSource.lasting("sk-stub"),
        later: ModelSource.lasting("sk-later"),
      })
      const script = ModelSource.stub.script()
      yield* opened.restart({ model: { endpointId: "later", modelId: "stub-model" } }, `later ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-later")
    }),
  )

  it.live("a base URL moved on Ren reaches the next turn together with its key", () =>
    Effect.gen(function* () {
      const opened = yield* ModelSource.chat(ModelSource.access({ stub: ModelSource.lasting("sk-stub") }))
      ModelSource.source.access = ModelSource.access(
        { stub: ModelSource.lasting("sk-moved") },
        ModelSource.stub.url.replace(/\/v1$/u, "/moved/v1"),
      )
      const script = ModelSource.stub.script()
      yield* opened.restart({}, `moved ${script.marker}`)
      const call = yield* Effect.promise(() => script.called())
      expect([call.path, call.authorization]).toEqual(["/moved/v1/chat/completions", "Bearer sk-moved"])
    }),
  )
})
