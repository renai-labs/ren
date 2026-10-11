import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"
import { stabilizeOpenApi } from "../script/openapi-stabilize.js"

describe("OpenAPI", () => {
  test("documents the health endpoint", () => {
    expect(OpenApi.fromApi(ClientApi).paths["/api/health"]?.get?.operationId).toBe("health.get")
  })

  test("documents the me endpoint behind authentication", () => {
    const operation = OpenApi.fromApi(ClientApi).paths["/api/me"]?.get
    expect(operation?.operationId).toBe("me.get")
    expect(operation?.security).toEqual([{ bearer: [] }, { cookie: [] }])
  })

  test("sorts component schemas", () => {
    const names = Object.keys(stabilizeOpenApi(OpenApi.fromApi(ClientApi)).components.schemas)
    expect(names).toEqual(names.toSorted())
  })
})
