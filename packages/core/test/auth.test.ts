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
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
        }),
        { asPrimary: true },
      ),
    ),
  ),
)

const post = (auth: Auth.Interface, path: string, body: unknown, headers?: Record<string, string>) =>
  Effect.promise(() =>
    auth.handler(
      new Request(`http://localhost:4000/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:4000", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  )

const signUp = (auth: Auth.Interface, email: string) =>
  post(auth, "/sign-up/email", { email, password: "correct horse battery staple", name: "Ada" })

describe("Auth", () => {
  it.live("signs up and reads the user back from the session cookie", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* signUp(auth, "ada@example.com")
      expect(response.status).toBe(200)

      const headers = new Headers({ cookie: response.headers.getSetCookie().join("; ") })
      const user = Option.getOrThrow(yield* auth.getUser(headers))
      expect(user).toEqual({
        id: expect.stringMatching(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/),
        name: "Ada",
        email: "ada@example.com",
        emailVerified: false,
        image: null,
      })
    }),
  )

  it.live("reads the user from a bearer token", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* signUp(auth, "grace@example.com")
      const token = response.headers.get("set-auth-token")
      expect(token).not.toBeNull()

      const user = Option.getOrThrow(yield* auth.getUser(new Headers({ authorization: `Bearer ${token}` })))
      expect(user.email).toBe("grace@example.com")
    }),
  )

  it.live("rejects an unknown bearer token", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const user = yield* auth.getUser(new Headers({ authorization: "Bearer not-a-session" }))
      expect(Option.isNone(user)).toBe(true)
    }),
  )

  it.live("starts google sign-in with the configured client and callback", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* post(auth, "/sign-in/social", { provider: "google", callbackURL: "/" })
      expect(response.status).toBe(200)
      const url = new URL((yield* Effect.promise(() => response.json())).url)
      expect(url.origin).toBe("https://accounts.google.com")
      expect(url.searchParams.get("client_id")).toBe("google-client-id")
      expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4000/api/auth/callback/google")
    }),
  )

  it.live("creates organizations with normalized, unique slugs", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const cookie = (yield* signUp(auth, "linus@example.com")).headers.getSetCookie().join("; ")
      const create = Effect.fnUntraced(function* () {
        const response = yield* post(auth, "/organization/create", { name: "Acme Inc", slug: "Acme Inc!" }, { cookie })
        expect(response.status).toBe(200)
        return yield* Effect.promise(() => response.json())
      })

      const first = yield* create()
      const second = yield* create()
      expect(first.id).toMatch(/^org_[0-9A-HJKMNP-TV-Z]{26}$/)
      expect([first.slug, second.slug]).toEqual(["acme-inc", "acme-inc-2"])
    }),
  )

  it.live("does not let members leave an organization", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* post(auth, "/organization/leave", { organizationId: "org_unknown" })
      expect(response.status).toBe(404)
    }),
  )

  it.live("has no user without credentials", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      expect(Option.isNone(yield* auth.getUser(new Headers()))).toBe(true)
    }),
  )

  it.effect("gives every model a prefixed ID", () =>
    Effect.sync(() => {
      const auth = Auth.make({
        database: drizzle.mock(),
        secret: "unused",
        baseURL: "http://localhost:4000",
        trustedOrigins: [],
        google: { clientId: "unused", clientSecret: "unused" },
      })
      const models = Object.keys(getAuthTables(auth.options))
      const ids = models.map((model) => auth.options.advanced.database.generateId({ model }))
      expect(ids.filter((id) => !/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toEqual([])
      expect(new Set(ids.map((id) => id.split("_")[0])).size).toBe(models.length)
    }),
  )
})
