import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"
import { stabilizeOpenApi } from "../script/openapi-stabilize.js"

describe("OpenAPI", () => {
  test("sorts component schemas", () => {
    const names = Object.keys(stabilizeOpenApi(OpenApi.fromApi(ClientApi)).components.schemas)
    expect(names).toEqual(names.toSorted())
  })
})
