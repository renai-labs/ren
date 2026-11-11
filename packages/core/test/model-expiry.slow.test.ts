import { describe, expect, setDefaultTimeout } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Effect } from "effect"
import { testEffect } from "./lib/effect.js"
import { ModelSource } from "./lib/model-source.js"

setDefaultTimeout(60_000)

const it = testEffect(ModelSource.layer)

describe("models on a brain, through the pull", () => {
  it.live("a key that expired is granted anew on the next send: the brain pulls on ModelsNotConfigured", () =>
    Effect.gen(function* () {
      const expiresAt = Date.now() + 10_000
      const opened = yield* ModelSource.chat(ModelSource.access({ stub: Shared.apiKey("sk-short", expiresAt) }))
      ModelSource.source.access = ModelSource.access({ stub: ModelSource.lasting("sk-long") })
      yield* Effect.sleep(Math.max(0, expiresAt - Date.now() + 500))
      const script = ModelSource.stub.script()
      yield* opened.send(`expired ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-long")
    }),
  )
})
