import { afterAll, describe, expect, test } from "bun:test"
import { UnauthorizedError } from "@ren/protocol/errors"
import { Authentication, CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Auth } from "../src/auth.js"
import { AuthenticationLayer } from "../src/middleware/authentication.js"
import { Routes } from "../src/routes.js"
import { makeApp } from "./lib/app.js"

const ProtectedApi = HttpApi.make("protected").add(
  HttpApiGroup.make("test.protected")
    .add(
      HttpApiEndpoint.get("me", "/test/me", {
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

const routes = Layer.mergeAll(Routes.layer, ProtectedRoutes)

const app = makeApp(routes)
const secureApp = makeApp(routes, { baseURL: "https://localhost:4000" })

afterAll(async () => {
  await app.dispose()
  await secureApp.dispose()
})

const signUp = async (email: string, handler = app.handler, baseURL = "http://localhost:4000") => {
  const response = await handler(
    new Request(`${baseURL}/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery staple", name: "Ada" }),
    }),
  )
  expect(response.status).toBe(200)
  return response
}

const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")

const me = (headers: HeadersInit = {}) => app.handler(new Request("http://localhost:4000/test/me", { headers }))

describe("Authentication", () => {
  test("returns 401 without credentials", async () => {
    const response = await me()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: "UnauthorizedError" })
  })

  test("provides the user from the session cookie", async () => {
    const response = await signUp("ada@example.com")
    const user = await me({ cookie: sessionCookie(response) })
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

  test("authenticates the secure-prefixed session cookie over HTTPS", async () => {
    const response = await signUp("ivy@example.com", secureApp.handler, "https://localhost:4000")
    const cookie = sessionCookie(response)
    expect(cookie.startsWith("__Secure-")).toBe(true)
    const user = await secureApp.handler(new Request("https://localhost:4000/test/me", { headers: { cookie } }))
    expect(user.status).toBe(200)
    expect(await user.json()).toMatchObject({ email: "ivy@example.com" })
  })
})
