import { describe, expect, test } from "bun:test"
import { Identifier } from "@ren/schema/identifier"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"
import { Exposure } from "../src/exposure.js"
import { Primitive } from "../src/primitive.js"
import { checkContract } from "../script/contract.js"

const ID = Identifier.make("tst", "Thing.ID")
const Info = Schema.Struct({ id: ID, name: Schema.String }).annotate({ identifier: "Thing.Info" })
const definition = { name: "thing", plural: "things", id: ID, info: Info, get: true, archive: true } as const

describe("checkContract", () => {
  test("accepts the served API", () => {
    expect(checkContract(ClientApi)).toEqual([])
  })

  test("accepts a primitive group that serves every declared operation", () => {
    const api = HttpApi.make("test").add(
      Primitive.group(definition, "sdk", [Primitive.get(definition), Primitive.archive(definition)]),
    )
    expect(checkContract(api)).toEqual([])
  })

  test("rejects a primitive group that omits a declared operation", () => {
    const api = HttpApi.make("test").add(Primitive.group(definition, "sdk", [Primitive.get(definition)]))
    expect(checkContract(api)).toEqual(["server.thing is missing DELETE /api/things/:id thing.archive"])
  })

  test("rejects a hand-written group outside the exceptions", () => {
    const api = HttpApi.make("test").add(
      HttpApiGroup.make("thing")
        .add(
          HttpApiEndpoint.get("thing.search", "/things/search").annotateMerge(
            OpenApi.annotations({ identifier: "thing.find" }),
          ),
        )
        .annotate(Exposure, "sdk"),
    )
    expect(checkContract(api)).toEqual([
      "thing is not named server.<domain>",
      "thing.search is not served under /api/",
      "thing.search has no matching OpenAPI identifier",
      "thing is not built with Primitive.group and is not an allowed exception",
    ])
  })
})
