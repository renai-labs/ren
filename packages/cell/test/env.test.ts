import { describe, expect } from "bun:test"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { CredentialEnv } from "../src/credential-env.js"
import { testEffect } from "@ren/executor/testing"

const it = testEffect(CredentialEnv.layer)

describe("CredentialEnv (HR18)", () => {
  it.effect("each pull's env vars apply at once, an addition and a removal alike", () =>
    Effect.gen(function* () {
      const env = yield* CredentialEnv.Service
      yield* env.apply({ variables: {}, placeholders: { STRIPE_API_KEY: "ren:STRIPE_API_KEY" } }, [])
      const running = yield* env.current
      yield* env.apply({ variables: {}, placeholders: { LINEAR_API_KEY: "ren:LINEAR_API_KEY" } }, [])
      expect(running.placeholders).toEqual({ STRIPE_API_KEY: "ren:STRIPE_API_KEY" })
      expect((yield* env.current).placeholders).toEqual({ LINEAR_API_KEY: "ren:LINEAR_API_KEY" })
    }),
  )

  it.effect("a chat's processes get its co-authors in REN_CO_AUTHORS, and no other chat's", () =>
    Effect.gen(function* () {
      const env = yield* CredentialEnv.Service
      const credited = Session.ID.make("ses_credited")
      const other = Session.ID.make("ses_other")
      yield* env.apply({ variables: { GITHUB_URL: "https://github.com" }, placeholders: {} }, [
        {
          id: credited,
          agent: null,
          archived: false,
          coAuthors: ["ada-gh <42+ada-gh@users.noreply.github.com>", "ren[bot] <9+ren[bot]@users.noreply.github.com>"],
        },
        { id: other, agent: null, archived: false },
      ])
      expect((yield* env.of(credited)).variables).toEqual({
        GITHUB_URL: "https://github.com",
        REN_CO_AUTHORS: "ada-gh <42+ada-gh@users.noreply.github.com>\nren[bot] <9+ren[bot]@users.noreply.github.com>",
      })
      expect((yield* env.of(other)).variables).toEqual({ GITHUB_URL: "https://github.com" })
    }),
  )
})
