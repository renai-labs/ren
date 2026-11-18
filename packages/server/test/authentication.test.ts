import { afterAll, describe, expect, test } from "bun:test"
import { ForbiddenError, UnauthorizedError } from "@ren/protocol/errors"
import { ActiveOrganization, CurrentOrganization } from "@ren/protocol/middleware/active-organization"
import { Authentication } from "@ren/protocol/middleware/authentication"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Auth } from "../src/auth.js"
import { ActiveOrganizationLayer } from "../src/middleware/active-organization.js"
import { AuthenticationLayer } from "../src/middleware/authentication.js"
import { Routes } from "../src/routes.js"
import { authRequest, makeApp, sessionCookie, signUp } from "./lib/app.js"

const ScopedApi = HttpApi.make("scoped").add(
  HttpApiGroup.make("test.scoped")
    .add(
      HttpApiEndpoint.get("organization", "/test/organization", {
        success: Schema.Struct({ id: Schema.String, roles: Schema.Array(Schema.String) }),
        error: [UnauthorizedError, ForbiddenError],
      }),
    )
    .middleware(ActiveOrganization)
    .middleware(Authentication),
)

const ScopedRoutes = HttpApiBuilder.layer(ScopedApi).pipe(
  Layer.provide(
    HttpApiBuilder.group(ScopedApi, "test.scoped", (handlers) =>
      handlers.handle("organization", () =>
        Effect.gen(function* () {
          return yield* CurrentOrganization
        }),
      ),
    ),
  ),
  Layer.provide([ActiveOrganizationLayer, AuthenticationLayer]),
  Layer.provide(Auth.layer),
)

const app = makeApp(Layer.mergeAll(Routes.layer, ScopedRoutes))
const secureApp = makeApp(undefined, { baseURL: "https://localhost:4000" })

afterAll(async () => {
  await app.dispose()
  await secureApp.dispose()
})

const organization = (cookie: string) =>
  app.handler(new Request("http://localhost:4000/test/organization", { headers: { cookie } }))

const me = (headers: HeadersInit = {}) => app.handler(new Request("http://localhost:4000/me", { headers }))

describe("Authentication", () => {
  test.each([
    { name: "without credentials", headers: {} },
    { name: "for an unknown bearer token", headers: { authorization: "Bearer not-a-session" } },
  ])("returns 401 $name", async (row) => {
    const response = await me(row.headers)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: "UnauthorizedError" })
  })

  test("provides the user from a bearer token", async () => {
    const response = await signUp(app, "grace@example.com")
    const user = await me({ authorization: `Bearer ${response.headers.get("set-auth-token")}` })
    expect(user.status).toBe(200)
    expect(await user.json()).toMatchObject({ user: { email: "grace@example.com" } })
  })

  test("authenticates the secure-prefixed session cookie over HTTPS", async () => {
    const cookie = sessionCookie(await signUp(secureApp, "ivy@example.com", "Ivy", "https://localhost:4000"))
    expect(cookie.startsWith("__Secure-")).toBe(true)
    const user = await secureApp.handler(new Request("https://localhost:4000/me", { headers: { cookie } }))
    expect(user.status).toBe(200)
    expect(await user.json()).toMatchObject({ user: { email: "ivy@example.com" } })
  })

  test("returns 401 for a session cookie after the session is revoked", async () => {
    const cookie = sessionCookie(await signUp(app, "revoked@example.com"))
    expect((await me({ cookie })).status).toBe(200)
    await app.handler(authRequest("/sign-out", {}, cookie))
    expect((await me({ cookie })).status).toBe(401)
  })

  test("answers 401 to a signed-out request for a favicon", async () => {
    expect((await app.handler(new Request("http://localhost:4000/favicons/stripe.com"))).status).toBe(401)
  })
})

describe("ActiveOrganization", () => {
  test("provides the active organization and the caller's roles in it", async () => {
    const response = await organization(sessionCookie(await signUp(app, "margaret@gmail.com", "Margaret")))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: expect.stringMatching(/^org_/), roles: ["owner"] })
  })

  test("returns 403 when the user has no organization", async () => {
    const owner = sessionCookie(await signUp(app, "owner@gmail.com", "Owner"))
    await app.handler(authRequest("/organization/invite-member", { email: "invitee@gmail.com", role: "member" }, owner))
    const response = await organization(sessionCookie(await signUp(app, "invitee@gmail.com")))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ _tag: "ForbiddenError" })
  })
})
