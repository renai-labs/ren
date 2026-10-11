import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ActiveOrganization } from "../src/middleware/active-organization.js"
import { Authentication } from "../src/middleware/authentication.js"

const spec = OpenApi.fromApi(
  HttpApi.make("test").add(
    HttpApiGroup.make("scoped")
      .add(HttpApiEndpoint.get("scoped.get", "/api/scoped", { success: Schema.String }))
      .middleware(ActiveOrganization)
      .middleware(Authentication),
  ),
)

describe("ActiveOrganization", () => {
  test("documents the 403 response alongside the 401", () => {
    expect(spec.paths["/api/scoped"]?.get?.responses).toHaveProperty("401")
    expect(spec.paths["/api/scoped"]?.get?.responses).toHaveProperty("403")
  })
})
