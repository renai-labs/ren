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

const organization = (cookie: string) =>
  app.handler(new Request("http://localhost:4000/test/organization", { headers: { cookie } }))

describe("ActiveOrganization", () => {
  test("provides the active organization", async () => {
    const response = await organization(sessionCookie(await signUp(app, "margaret@gmail.com", "Margaret")))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: expect.stringMatching(/^org_/) })
  })

  test("returns 403 when the user has no organization", async () => {
    const owner = sessionCookie(await signUp(app, "owner@gmail.com", "Owner"))
    await app.handler(authRequest("/organization/invite-member", { email: "invitee@gmail.com", role: "member" }, owner))
    const response = await organization(sessionCookie(await signUp(app, "invitee@gmail.com")))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ _tag: "ForbiddenError" })
  })
})
