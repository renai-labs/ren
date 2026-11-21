import { describe, expect, test } from "bun:test"
import { FileTabs } from "../src/file-tabs.js"

const paths = (state: FileTabs.State) => state.tabs.map((tab) => tab.path)

const pinned = (count: number) =>
  Array.from({ length: count }, (_, index) => `f${index}`).reduce(
    (state, path) => FileTabs.open(state, path, { pin: true }),
    FileTabs.empty,
  )

describe("FileTabs", () => {
  test("a single open is a preview that the next open replaces", () => {
    const state = FileTabs.open(FileTabs.open(FileTabs.empty, "a.ts"), "b.ts")
    expect(paths(state)).toEqual(["b.ts"])
    expect(state.active).toBe("b.ts")
    expect(state.tabs[0]?.preview).toBe(true)
  })

  test("a pinned tab stays when the next file opens", () => {
    const state = FileTabs.open(FileTabs.open(FileTabs.empty, "a.ts", { pin: true }), "b.ts")
    expect(paths(state)).toEqual(["a.ts", "b.ts"])
    expect(state.tabs.map((tab) => tab.preview)).toEqual([false, true])
  })

  test("pinning keeps a preview tab", () => {
    const state = FileTabs.open(FileTabs.pin(FileTabs.open(FileTabs.empty, "a.ts"), "a.ts"), "b.ts")
    expect(paths(state)).toEqual(["a.ts", "b.ts"])
  })

  test("opening an open file activates it and a double click pins it", () => {
    const state = FileTabs.open(FileTabs.open(pinned(2), "f0", { pin: false }), "f1", { pin: true })
    expect(paths(state)).toEqual(["f0", "f1"])
    expect(state.active).toBe("f1")
    expect(state.tabs.every((tab) => !tab.preview)).toBe(true)
  })

  test("the 11th tab closes the oldest preview, else the oldest tab", () => {
    const withPreview = FileTabs.open(pinned(9), "p")
    expect(paths(FileTabs.open(withPreview, "q", { pin: true }))).toEqual([...paths(pinned(9)), "q"])
    expect(paths(FileTabs.open(pinned(10), "extra", { pin: true }))).toEqual([...paths(pinned(10)).slice(1), "extra"])
    expect(paths(FileTabs.open(pinned(10), "extra"))).toHaveLength(10)
  })

  test("closing the active tab activates its neighbour", () => {
    const state = FileTabs.close(FileTabs.open(pinned(3), "f1", { pin: true }), "f1")
    expect(paths(state)).toEqual(["f0", "f2"])
    expect(state.active).toBe("f2")
    expect(FileTabs.close(FileTabs.close(state, "f2"), "f0")).toEqual(FileTabs.empty)
  })
})
