import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Primitive } from "../src/primitive.js"

describe("Primitive.Slug", () => {
  test.each(["build", "a", "qa-2", "release-notes", "a".repeat(64)])("accepts %s", (slug) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Primitive.Slug)(slug))).toBe(true)
  })

  test.each(["", "-build", "build-", "release--notes", "Build", "build_1", "a".repeat(65)])("rejects %s", (slug) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Primitive.Slug)(slug))).toBe(false)
  })
})
