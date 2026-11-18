import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Reference } from "../src/reference.js"

describe("Reference.Branch", () => {
  test.each(["main", "release/v2"])("accepts %s", (branch) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Branch)(branch))).toBe(true)
  })

  test.each(["-main", "a..b", "a//b", "a@{b", "main.lock", "a b", "a~b", "main/", "main."])("rejects %s", (branch) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Branch)(branch))).toBe(false)
  })
})

describe("Reference.Repository", () => {
  test.each(["https://github.com/acme/docs", "https://gitlab.com/acme/group/docs"])("accepts %s", (repository) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Repository)(repository))).toBe(true)
  })

  test.each(["http://github.com/acme/docs", "https://github.com/acme", "https://github.com/acme/docs/"])(
    "rejects %s",
    (repository) => {
      expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Repository)(repository))).toBe(false)
    },
  )
})

describe("Reference.Alias", () => {
  test("refuses a colon, which only an alias that Ren derives has, such as drive:space", () => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Alias)("docs.v2_main-2"))).toBe(true)
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Alias)("drive:space"))).toBe(false)
  })
})
