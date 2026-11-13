import { describe, expect, test } from "bun:test"
import { ComposerHistory } from "../src/composer-history.js"

const entry = (text: string, pasted: ReadonlyArray<string> = []): ComposerHistory.Entry => ({
  text,
  pasted: pasted.map((item, index) => ({ id: `p${index}`, text: item })),
})

describe("Composer history", () => {
  test("different comments or sources on the same quote remain distinct history entries", () => {
    const quote = { id: "q1", text: "up 12%", comment: "Explain", source: "Ren" }
    const original = {
      text: "Why?",
      pasted: [],
      quotes: [quote],
    }
    const history = ComposerHistory.prepend([], original)
    expect(
      ComposerHistory.prepend(history, {
        ...original,
        quotes: [{ ...quote, id: "q2", comment: "Check" }],
      }),
    ).toHaveLength(2)
    expect(ComposerHistory.prepend(history, { ...original, quotes: [{ ...quote, source: "Ada" }] })).toHaveLength(2)
  })
  test("prependHistoryEntry skips empty prompt and deduplicates consecutive entries", () => {
    expect(ComposerHistory.prepend([], entry("  "))).toEqual([])
    const withOne = ComposerHistory.prepend([], entry("hello"))
    expect(withOne).toEqual([entry("hello")])
    expect(ComposerHistory.prepend(withOne, entry("hello"))).toBe(withOne)
    expect(ComposerHistory.prepend(withOne, entry("hello", ["block"]))).toHaveLength(2)
  })

  test("keeps the quotes of an entry, and an entry of quotes alone is not empty", () => {
    const quoted = { text: "", pasted: [], quotes: [{ id: "q1", text: "up 12%" }] }
    const kept = ComposerHistory.prepend([], quoted)
    expect(kept).toEqual([quoted])
    expect(ComposerHistory.decode(ComposerHistory.encode(kept))).toEqual(kept)
    expect(ComposerHistory.prepend(kept, { ...quoted, quotes: [{ id: "q2", text: "other" }] })).toHaveLength(2)
  })

  test("keeps the newest 100 entries", () => {
    const full = Array.from({ length: 100 }, (_, index) => entry(`entry ${index}`))
    const next = ComposerHistory.prepend(full, entry("newest"))
    expect(next).toHaveLength(100)
    expect(next[0]).toEqual(entry("newest"))
    expect(next.at(-1)).toEqual(entry("entry 98"))
  })

  test("removeHistoryEntry drops the entry recorded for a prompt and leaves others alone", () => {
    const entries = ComposerHistory.prepend(ComposerHistory.prepend([], entry("earlier")), entry("sent"))
    expect(ComposerHistory.remove(entries, entry("never sent"))).toBe(entries)
    expect(ComposerHistory.remove(entries, entry("sent"))).toEqual([entry("earlier")])
  })

  test("drops corrupt entries one by one", () => {
    expect(ComposerHistory.decode(JSON.stringify([{ text: "kept", pasted: [] }, { text: 3 }, "bare"]))).toEqual([
      entry("kept"),
    ])
    expect(ComposerHistory.decode("nope")).toEqual([])
    expect(ComposerHistory.decode(undefined)).toEqual([])
  })
})

describe("Composer history navigation", () => {
  const entries = [entry("newest"), entry("older")]

  test("Up opens history only from an empty prompt with the cursor at the start", () => {
    expect(ComposerHistory.navigate(ComposerHistory.idle, "up", entries, entry("draft"), 0)).toBeUndefined()
    expect(ComposerHistory.navigate(ComposerHistory.idle, "up", [], entry(""), 0)).toBeUndefined()
    expect(ComposerHistory.navigate(ComposerHistory.idle, "up", entries, entry(""), 0)).toEqual({
      browsing: { index: 0, saved: entry("") },
      entry: entry("newest"),
      cursor: "start",
    })
  })

  test("Down outside history does nothing", () => {
    expect(ComposerHistory.navigate(ComposerHistory.idle, "down", entries, entry(""), 0)).toBeUndefined()
  })

  test("while browsing, moves from either end of the text and stops at the oldest entry", () => {
    const first = { index: 0, saved: entry("") }
    expect(ComposerHistory.navigate(first, "up", entries, entry("newest"), 3)).toBeUndefined()
    const second = ComposerHistory.navigate(first, "up", entries, entry("newest"), 6)
    expect(second).toEqual({ browsing: { index: 1, saved: entry("") }, entry: entry("older"), cursor: "start" })
    expect(ComposerHistory.navigate({ index: 1, saved: entry("") }, "up", entries, entry("older"), 0)).toBeUndefined()
    expect(ComposerHistory.navigate({ index: 1, saved: entry("") }, "down", entries, entry("older"), 0)).toEqual({
      browsing: { index: 0, saved: entry("") },
      entry: entry("newest"),
      cursor: "end",
    })
  })

  test("Down past the newest entry restores the saved draft", () => {
    expect(
      ComposerHistory.navigate({ index: 0, saved: entry("", ["kept block"]) }, "down", entries, entry("newest"), 6),
    ).toEqual({
      browsing: ComposerHistory.idle,
      entry: entry("", ["kept block"]),
      cursor: "end",
    })
  })
})
