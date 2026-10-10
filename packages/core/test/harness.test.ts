import { describe, expect, test } from "bun:test"
import { refuseNetwork } from "./lib/effect.js"

describe("test harness", () => {
  test("refuses and records non-loopback requests", async () => {
    const violations: string[] = []
    await expect(refuseNetwork(violations)("https://example.com/api")).rejects.toThrow("test attempted network request")
    expect(violations).toEqual([
      "test attempted network request: GET https://example.com/api — provide an explicit HttpClient or disable the fetch",
    ])
  })
})
