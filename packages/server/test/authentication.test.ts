import { afterAll, describe, expect, test } from "bun:test"
import { Auth } from "@ren/core/auth"
import { UnauthorizedError } from "@ren/protocol/errors"
import { Authentication, CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { AuthenticationLayer } from "../src/middleware/authentication.js"
import { Routes } from "../src/routes.js"
import { makeApp } from "./lib/app.js"

const ProtectedApi = HttpApi.make("protected").add(
  HttpApiGroup.make("test.protected")
    .add(
      HttpApiEndpoint.get("me", "/api/test/me", {
        success: Schema.Struct({ id: Schema.String, email: Schema.String }),
        error: UnauthorizedError,
      }),
    )
    .middleware(Authentication),
)

const ProtectedRoutes = HttpApiBuilder.layer(ProtectedApi).pipe(
  Layer.provide(
    HttpApiBuilder.group(ProtectedApi, "test.protected", (handlers) =>
      handlers.handle("me", () =>
        Effect.gen(function* () {
          return yield* CurrentUser
        }),
      ),
    ),
  ),
  Layer.provide(AuthenticationLayer),
  Layer.provide(Auth.layer),
)

const app = makeApp(Layer.mergeAll(Routes.layer, ProtectedRoutes))

afterAll(() => app.dispose())

const signUp = async (email: string) => {
  const response = await app.handler(
    new Request("http://localhost:4000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery staple", name: "Ada" }),
    }),
  )
  expect(response.status).toBe(200)
  return response
}

const me = (headers?: HeadersInit) => app.handler(new Request("http://localhost:4000/api/test/me", { headers }))

describe("Authentication", () => {
  test("returns 401 without credentials", async () => {
    const response = await me()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: "UnauthorizedError" })
  })

  test("provides the user from the session cookie", async () => {
    const response = await signUp("ada@example.com")
    const user = await me({ cookie: response.headers.getSetCookie().join("; ") })
    expect(user.status).toBe(200)
    expect(await user.json()).toMatchObject({ email: "ada@example.com", id: expect.stringMatching(/^usr_/) })
  })

  test("provides the user from a bearer token", async () => {
    const response = await signUp("grace@example.com")
    const user = await me({ authorization: `Bearer ${response.headers.get("set-auth-token")}` })
    expect(user.status).toBe(200)
    expect(await user.json()).toMatchObject({ email: "grace@example.com" })
  })

  test("returns 401 for an unknown bearer token", async () => {
    expect((await me({ authorization: "Bearer not-a-session" })).status).toBe(401)
  })

  test("returns 401 for an unknown session cookie", async () => {
    expect((await me({ cookie: "better-auth.session_token=not-a-session" })).status).toBe(401)
  })
})
