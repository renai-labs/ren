import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Auth, Identifier } from "../src/index.js"

describe("Identifier", () => {
  test("creates prefixed ULIDs that decode", () => {
    const id = Auth.UserID.create()
    expect(id).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(Schema.decodeUnknownSync(Auth.UserID)(id)).toBe(id)
  })

  test("orders IDs created in the same millisecond", () => {
    const ids = Array.from({ length: 100 }, () => Identifier.ulid())
    expect(ids.toSorted()).toEqual(ids)
  })

  test("accepts ren-v1 IDs", () => {
    expect(Schema.is(Auth.UserID)("usr_01JQ8Z6Y7K3M4N5P6Q7R8S9T0V")).toBe(true)
  })

  test("rejects another entity's prefix", () => {
    expect(Schema.is(Auth.UserID)(Auth.SessionID.create())).toBe(false)
  })

  test("rejects a bare ULID", () => {
    expect(Schema.is(Auth.UserID)(Identifier.ulid())).toBe(false)
  })
})
