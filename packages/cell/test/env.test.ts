import { describe, expect } from "bun:test"
import { Effect, Option } from "effect"
import { CredentialEnv } from "../src/credential-env.js"
import { testEffect } from "@ren/executor/testing"

const it = testEffect(CredentialEnv.layer)

describe("CredentialEnv (C47)", () => {
  it.effect("a new placeholder applies at once, also during a turn; a removed one goes at turn end", () =>
    Effect.gen(function* () {
      const env = yield* CredentialEnv.Service
      yield* env.apply("h1", { STRIPE_API_KEY: "ren:STRIPE_API_KEY" })
      expect(yield* env.current).toEqual({ STRIPE_API_KEY: "ren:STRIPE_API_KEY" })
      yield* env.apply("h2", { LINEAR_API_KEY: "ren:LINEAR_API_KEY" })
      expect(yield* env.current).toEqual({ STRIPE_API_KEY: "ren:STRIPE_API_KEY", LINEAR_API_KEY: "ren:LINEAR_API_KEY" })
      expect(yield* env.hash).toEqual(Option.some("h2"))
      yield* env.turnEnded
      expect(yield* env.current).toEqual({ LINEAR_API_KEY: "ren:LINEAR_API_KEY" })
    }),
  )
})
