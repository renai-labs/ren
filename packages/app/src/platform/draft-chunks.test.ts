import { describe, expect, test } from "bun:test"
import { DraftChunks } from "./draft-chunks.js"

const paste = Array.from({ length: 3 * DraftChunks.size }, (_, index) => String.fromCharCode(97 + (index % 26))).join(
  "",
)

describe("DraftChunks", () => {
  test("splits a large string into chunks that join back to it", () => {
    const chunks = DraftChunks.split(paste)
    expect(chunks).toHaveLength(3)
    expect(chunks.join("")).toBe(paste)
  })

  test("appending to a large string re-uploads only the final chunk", () => {
    const before = DraftChunks.split(paste)
    const indices = (next: ReadonlyArray<string>, previous?: ReadonlyArray<string>) =>
      DraftChunks.changed(previous, next).map((chunk) => chunk.index)
    expect(indices(before)).toEqual([0, 1, 2])
    expect(DraftChunks.changed(before, DraftChunks.split(`${paste}!`))).toEqual([{ index: 3, text: "!" }])
    expect(indices(DraftChunks.split(`${paste.slice(0, -1)}?`), before)).toEqual([2])
    expect(indices(before, before)).toEqual([])
  })

  test("chunk boundaries never split a surrogate pair", () => {
    const text = `${"x".repeat(DraftChunks.size - 1)}😀tail`
    const chunks = DraftChunks.split(text)
    expect(chunks.join("")).toBe(text)
    expect(chunks[0]).toHaveLength(DraftChunks.size + 1)
  })

  test("a missing chunk decodes to empty text instead of failing the document", () => {
    const stored = new Map([
      [0, "first "],
      [2, "third"],
    ])
    expect(DraftChunks.join(3, (index) => stored.get(index))).toBe("first third")
  })
})
