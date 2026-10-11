import { afterAll, describe, expect, test } from "bun:test"
import { Auth } from "@ren/core/auth"
import { ForbiddenError, UnauthorizedError } from "@ren/protocol/errors"
import { ActiveOrganization, CurrentOrganization } from "@ren/protocol/middleware/active-organization"
import { Authentication } from "@ren/protocol/middleware/authentication"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { ActiveOrganizationLayer } from "../src/middleware/active-organization.js"
import { AuthenticationLayer } from "../src/middleware/authentication.js"
import { Routes } from "../src/routes.js"
import { makeApp } from "./lib/app.js"

const ScopedApi = HttpApi.make("scoped").add(
  HttpApiGroup.make("test.scoped")
    .add(
      HttpApiEndpoint.get("organization", "/api/test/organization", {
        success: Schema.Struct({ id: Schema.String }),
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

afterAll(() => app.dispose())

const post = (path: string, body: unknown, cookie?: string) =>
  app.handler(
    new Request(`http://localhost:4000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:4000", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )

const signUp = async (email: string) => {
  const response = await post("/sign-up/email", { email, password: "correct horse battery staple", name: "Ada" })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().join("; ")
}

const organization = (cookie?: string) =>
  app.handler(new Request("http://localhost:4000/api/test/organization", { headers: cookie ? { cookie } : {} }))

describe("ActiveOrganization", () => {
  test("returns 401 before checking the organization", async () => {
    const response = await organization()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: "UnauthorizedError" })
  })

  test("provides the active organization", async () => {
    const response = await organization(await signUp("ada@example.com"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: expect.stringMatching(/^org_/) })
  })

  test("returns 403 when the user has no organization", async () => {
    const owner = await signUp("owner@example.com")
    expect(
      (await post("/organization/invite-member", { email: "invitee@gmail.com", role: "member" }, owner)).status,
    ).toBe(200)
    const response = await organization(await signUp("invitee@gmail.com"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ _tag: "ForbiddenError" })
  })
})
