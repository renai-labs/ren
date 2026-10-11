import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Authentication } from "../src/middleware/authentication.js"

const spec = OpenApi.fromApi(
  HttpApi.make("test").add(
    HttpApiGroup.make("protected")
      .add(HttpApiEndpoint.get("protected.get", "/api/protected", { success: Schema.String }))
      .middleware(Authentication),
  ),
)

describe("Authentication", () => {
  test("documents the bearer token and the session cookie", () => {
    expect(spec.components.securitySchemes).toEqual({
      bearer: expect.objectContaining({ type: "http", scheme: "Bearer" }),
      cookie: expect.objectContaining({ type: "apiKey", in: "cookie", name: "better-auth.session_token" }),
    })
    expect(spec.paths["/api/protected"]?.get?.security).toEqual([{ bearer: [] }, { cookie: [] }])
  })

  test("documents the 401 response", () => {
    expect(spec.paths["/api/protected"]?.get?.responses).toHaveProperty("401")
  })
})
