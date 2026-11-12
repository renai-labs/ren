import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Artifact } from "../src/artifact.js"

const accepts = (paths: ReadonlyArray<string>) =>
  Exit.isSuccess(Schema.decodeUnknownExit(Artifact.Files)(Object.fromEntries(paths.map((path) => [path, btoa("x")]))))

describe("Artifact", () => {
  test("rejects unsafe or reserved Durable Object bindings and invalid class names", () => {
    const decode = Schema.decodeUnknownExit(Artifact.Config)
    expect(Exit.isSuccess(decode({ entry: "index.html", durableObjects: { STATE: "SampleState" } }))).toBe(true)
    expect(Exit.isFailure(decode({ entry: "index.html", durableObjects: { ASSETS: "SampleState" } }))).toBe(true)
    expect(Exit.isFailure(decode({ entry: "index.html", durableObjects: { "bad-name": "SampleState" } }))).toBe(true)
    expect(Exit.isFailure(decode({ entry: "index.html", durableObjects: { STATE: "../state" } }))).toBe(true)
  })

  test("rejects a file with an unsafe path instead of dropping it", () => {
    expect(accepts(["index.html", "assets/app.js"])).toBe(true)
    expect(accepts(["index.html", "../app.js"])).toBe(false)
  })
})
