import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Artifact } from "../src/artifact.js"

const accepts = (entry: string, paths: ReadonlyArray<string>) =>
  Exit.isSuccess(
    Schema.decodeUnknownExit(Artifact.PublishInput)({
      operationId: crypto.randomUUID(),
      title: "Report",
      entry,
      files: Object.fromEntries(paths.map((path) => [path, btoa("x")])),
    }),
  )

describe("Artifact.PublishInput", () => {
  test("rejects a file with an unsafe path instead of dropping it", () => {
    expect(accepts("index.html", ["index.html", "assets/app.js"])).toBe(true)
    expect(accepts("index.html", ["index.html", "../app.js"])).toBe(false)
  })

  test("rejects an entry that is not one of the files", () => {
    expect(accepts("report.html", ["index.html"])).toBe(false)
  })
})
