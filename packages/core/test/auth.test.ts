import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { getAuthTables } from "better-auth/db"
import { drizzle } from "drizzle-orm/bun-sql/postgres"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { Auth } from "../src/auth.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(
  Auth.layer.pipe(
    Layer.provide(Testing.layer),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({
          BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
          BETTER_AUTH_URL: "http://localhost:4000",
        }),
        { asPrimary: true },
      ),
    ),
  ),
)

const signUp = (auth: Auth.Interface, email: string) =>
  Effect.promise(() =>
    auth.handler(
      new Request("http://localhost:4000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "correct horse battery staple", name: "Ada" }),
      }),
    ),
  )

describe("Auth", () => {
  it.live("signs up and reads the session back from its cookie", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* signUp(auth, "ada@example.com")
      expect(response.status).toBe(200)

      const headers = new Headers({ cookie: response.headers.getSetCookie().join("; ") })
      const session = Option.getOrThrow(yield* auth.getSession(headers))
      expect(session.user.email).toBe("ada@example.com")
      expect(session.user.id).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(session.session.id).toMatch(/^aus_[0-9A-HJKMNP-TV-Z]{26}$/)
    }),
  )

  it.live("has no session without credentials", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      expect(Option.isNone(yield* auth.getSession(new Headers()))).toBe(true)
    }),
  )

  it.effect("gives every model a prefixed ID", () =>
    Effect.sync(() => {
      const auth = Auth.make({
        database: drizzle.mock(),
        secret: "unused",
        baseURL: "http://localhost:4000",
        trustedOrigins: [],
      })
      const models = Object.keys(getAuthTables(auth.options))
      const ids = models.map((model) => auth.options.advanced.database.generateId({ model }))
      expect(ids.filter((id) => !/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toEqual([])
      expect(new Set(ids.map((id) => id.split("_")[0])).size).toBe(models.length)
    }),
  )
})
