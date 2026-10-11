import { describe, expect, test } from "bun:test"
import { Identifier } from "@ren/schema/identifier"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { ClientApi } from "../src/client.js"
import { Primitive } from "../src/primitive.js"
import { checkContract } from "../script/contract.js"

const ID = Identifier.make("tst", "Thing.ID")
const Info = Schema.Struct({ id: ID, name: Schema.String }).annotate({ identifier: "Thing.Info" })
const definition = {
  name: "thing",
  plural: "things",
  id: ID,
  info: Info,
  get: true,
  archive: true,
  actions: { checkout: { input: Schema.Struct({}), result: Info } },
} as const

describe("checkContract", () => {
  test("accepts the served API", () => {
    expect(checkContract(ClientApi)).toEqual([])
  })

  test("accepts a primitive group that serves every declared operation", () => {
    const api = HttpApi.make("test").add(
      Primitive.group(definition, "sdk", [
        Primitive.get(definition),
        Primitive.archive(definition),
        Primitive.action(definition, "checkout"),
      ]),
    )
    expect(checkContract(api)).toEqual([])
  })

  test("rejects a primitive group that omits a declared operation", () => {
    const api = HttpApi.make("test").add(
      Primitive.group(definition, "sdk", [Primitive.get(definition), Primitive.archive(definition)]),
    )
    expect(checkContract(api)).toEqual(["thing is missing POST /api/things/:id/checkout thing.checkout"])
  })

  test("rejects a primitive group that serves an undeclared endpoint", () => {
    const api = HttpApi.make("test").add(
      Primitive.group(definition, "sdk", [
        Primitive.get(definition),
        Primitive.archive(definition),
        Primitive.action(definition, "checkout"),
        HttpApiEndpoint.get("thing.search", "/api/things/search"),
      ]),
    )
    expect(checkContract(api)).toEqual(["thing has undeclared GET /api/things/search thing.search"])
  })

  test("rejects a hand-written group that is not a listed exception", () => {
    const api = HttpApi.make("test").add(
      HttpApiGroup.make("thing").add(HttpApiEndpoint.get("thing.search", "/api/things/search")),
    )
    expect(checkContract(api)).toEqual(["thing is neither a primitive nor a listed exception"])
  })
})
