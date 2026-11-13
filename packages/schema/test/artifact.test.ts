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

  test("a name is a host name label that cannot look like a label or a reserved page", () => {
    const valid = Schema.is(Artifact.Name)
    expect(["hello", "hello-from-ren", "a", "x1"].every(valid)).toBe(true)
    expect(["", "-hello", "hello-", "Hello", "hello_world", "art-hello", "login", "a".repeat(64)].some(valid)).toBe(
      false,
    )
  })

  test("a title gives a default name, or none", () => {
    expect(Artifact.nameOf("Hello from Ren!")).toBe("hello-from-ren")
    expect(Artifact.nameOf("Café — menu")).toBe("cafe-menu")
    expect(Artifact.nameOf("Q3 report: revenue by region and product line, 2026")).toBe(
      "q3-report-revenue-by-region-and-product",
    )
    expect(Artifact.nameOf("日本語")).toBeUndefined()
    expect(Artifact.nameOf("Login")).toBeUndefined()
  })

  test("rejects a file with an unsafe path instead of dropping it", () => {
    expect(accepts(["index.html", "assets/app.js"])).toBe(true)
    expect(accepts(["index.html", "../app.js"])).toBe(false)
  })
})
