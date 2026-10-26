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

describe("Reference.Repository", () => {
  test.each(["https://github.com/acme/docs", "https://git.acme.dev/acme/docs.git"])("accepts %s", (repository) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Repository)(repository))).toBe(true)
  })

  test.each([
    "http://github.com/acme/docs",
    "file:///home/ada/docs",
    "github.com/acme/docs",
    "https://github.com/acme",
    "https://github.com/acme/docs/tree/main",
    "https://github.com/acme/docs/",
  ])("rejects %s", (repository) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Repository)(repository))).toBe(false)
  })
})

describe("Reference.Info", () => {
  test("requires a description", () => {
    const docs = { alias: "docs", repository: "https://github.com/acme/docs" }
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Info)(docs))).toBe(false)
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Reference.Info)({ ...docs, description: "Docs" }))).toBe(true)
  })
})
