import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CredentialEnv } from "../src/credential-env.js"
import { testEffect } from "@ren/executor/testing"

const it = testEffect(CredentialEnv.layer)

describe("CredentialEnv (HR18)", () => {
  it.effect("each pull's env vars apply at once, an addition and a removal alike", () =>
    Effect.gen(function* () {
      const env = yield* CredentialEnv.Service
      yield* env.apply({ variables: {}, placeholders: { STRIPE_API_KEY: "ren:STRIPE_API_KEY" } })
      const running = yield* env.current
      yield* env.apply({ variables: {}, placeholders: { LINEAR_API_KEY: "ren:LINEAR_API_KEY" } })
      expect(running.placeholders).toEqual({ STRIPE_API_KEY: "ren:STRIPE_API_KEY" })
      expect((yield* env.current).placeholders).toEqual({ LINEAR_API_KEY: "ren:LINEAR_API_KEY" })
    }),
  )
})
