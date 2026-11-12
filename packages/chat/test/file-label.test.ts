import { describe, expect, test } from "bun:test"
import { FileLabel } from "../src/file-label.js"

describe("FileLabel", () => {
  test("shows the base name alone when no other chip shares it", () => {
    const [label] = FileLabel.labels(["src/app.tsx"])
    expect(label).toMatchObject({ name: "app.tsx", dir: undefined, line: undefined, folder: false })
  })

  test("adds the parent folder when two different paths share a name", () => {
    const labels = FileLabel.labels(["src/routes/index.ts", "src/lib/index.ts", "src/app.tsx"])
    expect(labels.map((label) => label.dir)).toEqual(["routes", "lib", undefined])
  })

  test("the same path twice is not a collision", () => {
    expect(FileLabel.labels(["src/a.ts", "src/a.ts:3"]).map((label) => label.dir)).toEqual([undefined, undefined])
  })

  test("reads a line suffix and keeps it in the text", () => {
    const labels = FileLabel.labels(["src/app.tsx:42"])
    expect(labels).toMatchObject([{ path: "src/app.tsx", name: "app.tsx", line: 42 }])
    expect(FileLabel.parse("src/app.tsx:42:7").line).toBe(42)
  })

  test("a trailing slash makes a folder chip", () => {
    expect(FileLabel.labels(["src/lib/"])[0]).toMatchObject({ path: "src/lib", name: "lib", folder: true })
  })
})
