import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Health } from "../src/health.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Health.layer)

describe("Health", () => {
  it.effect("reports ok with the current version", () =>
    Effect.gen(function* () {
      const health = yield* Health.Service
      const info = yield* health.check()
      expect(info).toEqual({ status: "ok", version: "local" })
    }),
  )
})
