import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Primitive } from "../src/primitive.js"

describe("Primitive.Slug", () => {
  test.each(["qa-2", "a".repeat(64)])("accepts %s", (slug) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Primitive.Slug)(slug))).toBe(true)
  })

  test.each(["-build", "release--notes", "Build", "a".repeat(65)])("rejects %s", (slug) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Primitive.Slug)(slug))).toBe(false)
  })
})
