import { describe, expect, test } from "bun:test"
import { ComposerHistory } from "../src/composer-history.js"

const entry = (text: string, pasted: ReadonlyArray<string> = []): ComposerHistory.Entry => ({
  text,
  pasted: pasted.map((item, index) => ({ id: `p${index}`, text: item })),
})

describe("Composer history", () => {
  test("prependHistoryEntry skips empty prompt and deduplicates consecutive entries", () => {
    expect(ComposerHistory.prepend([], entry("  "))).toEqual([])
    const withOne = ComposerHistory.prepend([], entry("hello"), { now: 5 })
    expect(withOne).toEqual([{ text: "hello", pasted: [], sentAt: 5 }])
    expect(ComposerHistory.prepend(withOne, entry("hello"))).toBe(withOne)
    expect(ComposerHistory.prepend(withOne, entry("hello", ["block"]))).toHaveLength(2)
  })

  test("keeps the newest 100 entries", () => {
    const full = Array.from({ length: 100 }, (_, index) => entry(`entry ${index}`))
    const next = ComposerHistory.prepend(full, entry("newest"))
    expect(next).toHaveLength(100)
    expect(next[0]).toMatchObject(entry("newest"))
    expect(next.at(-1)).toEqual(entry("entry 98"))
  })

  test("removeHistoryEntry drops the entry recorded for a prompt and leaves others alone", () => {
    const entries = ComposerHistory.prepend(ComposerHistory.prepend([], entry("earlier")), entry("sent"))
    expect(ComposerHistory.remove(entries, entry("never sent"))).toBe(entries)
    expect(ComposerHistory.remove(entries, entry("sent"))).toEqual(entries.slice(1))
  })

  test("records when an entry was sent and still decodes entries without it", () => {
    const entries = ComposerHistory.prepend([], entry("new"), { now: 1000 })
    expect(entries[0]?.sentAt).toBe(1000)
    expect(ComposerHistory.decode(ComposerHistory.encode(entries))).toEqual(entries)
    expect(ComposerHistory.decode(JSON.stringify([{ text: "old", pasted: [] }]))).toEqual([entry("old")])
    expect(ComposerHistory.decode(JSON.stringify([{ text: "bad", pasted: [], sentAt: "x" }]))).toEqual([])
  })

  test("search matches the text without regard to case and keeps the order", () => {
    const entries = [entry("Update the Forecast"), entry("Draft a summary"), entry("why is the forecast off")]
    expect(ComposerHistory.search(entries, "FORECAST").map((item) => item.text)).toEqual([
      "Update the Forecast",
      "why is the forecast off",
    ])
    expect(ComposerHistory.search(entries, "  ")).toBe(entries)
    expect(ComposerHistory.search(entries, "zzz")).toEqual([])
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
