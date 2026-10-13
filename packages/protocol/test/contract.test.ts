import { expect, test } from "bun:test"
import { Identifier } from "@ren/schema/identifier"
import { Schema } from "effect"
import { HttpApi } from "effect/http-api"
import { Primitive } from "../src/primitive.js"
import { checkContract } from "../script/contract.js"

test("rejects a primitive group that omits a declared operation", () => {
  const ID = Identifier.make("tst", "Thing.ID")
  const definition = {
    name: "thing",
    plural: "things",
    id: ID,
    info: Schema.Struct({ id: ID }),
    get: true,
    archive: true,
  } as const
  const api = HttpApi.make("test").add(Primitive.group(definition, "sdk", [Primitive.get(definition)]))
  expect(checkContract(api)).toEqual(["thing is missing DELETE /things/:id thing.archive"])
})
