import { describe, expect, test } from "bun:test"
import { BrainApi } from "@ren/brain-api/brain-api"
import { HttpApi } from "effect/http-api"
import { Brain } from "../src/brain.js"

describe("Brain API routes", () => {
  test("every Brain API path is under the prefix the worker keeps for server tokens", () => {
    const paths: Array<string> = []
    HttpApi.reflect(BrainApi, { onGroup: () => {}, onEndpoint: (options) => paths.push(options.endpoint.path) })
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.filter((path) => !Brain.owns(path))).toEqual([])
  })

  test("the prefix covers every path below it, and nothing that only starts with the same letters", () => {
    expect(["/ren", "/ren/", "/ren/state", "/ren/unknown/deeper", "/rename", "/api/ren"].map(Brain.owns)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ])
  })
})
