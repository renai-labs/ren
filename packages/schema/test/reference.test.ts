import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Reference } from "../src/reference.js"

describe("Reference.Branch", () => {
  test.each(["main", "release/v2", "feature/add-settings"])("accepts %s", (branch) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Branch)(branch))).toBe(true)
  })

  test.each([
    "-main",
    "a..b",
    "a//b",
    "a@{b",
    "main.lock",
    "a b",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "main/",
    "main.",
  ])("rejects %s", (branch) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Branch)(branch))).toBe(false)
  })
})
