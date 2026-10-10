import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Health } from "../src/index.js"

describe("Health.Info", () => {
  test("decodes a healthy status", () => {
    expect(Schema.decodeUnknownSync(Health.Info)({ status: "ok", version: "0.0.0" })).toEqual({
      status: "ok",
      version: "0.0.0",
    })
  })

  test("rejects an unknown status", () => {
    expect(() => Schema.decodeUnknownSync(Health.Info)({ status: "down", version: "0.0.0" })).toThrow()
  })
})
