import { describe, expect, test } from "bun:test"
import { DraftStore } from "./draft-store.js"

const quotaStorage = (limit: number) => {
  const values = new Map<string, string>()
  const used = (except: string) =>
    [...values].reduce((total, entry) => (entry[0] === except ? total : total + entry[0].length + entry[1].length), 0)
  return {
    values,
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()].at(index) ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (used(key) + key.length + value.length > limit)
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
      values.set(key, value)
    },
    removeItem: (key: string) => void values.delete(key),
  }
}

const brokenStorage = {
  length: 0,
  key: () => null,
  getItem: () => {
    throw new DOMException("The operation is insecure.", "SecurityError")
  },
  setItem: () => {
    throw new DOMException("The operation is insecure.", "SecurityError")
  },
  removeItem: () => {
    throw new DOMException("The operation is insecure.", "SecurityError")
  },
}

const watcher = () => {
  const handlers = new Set<(key: string | null) => void>()
  return {
    watch: (handler: (key: string | null) => void) => {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
    emit: (key: string | null) => {
      for (const handler of handlers) handler(key)
    },
  }
}

describe("DraftStore", () => {
  test("a draft over the quota evicts the largest other drafts until it fits", () => {
    const storage = quotaStorage(80)
    storage.values.set("ren.theme.v1", "dark")
    const drafts = DraftStore.make({ storage, prefix: "ren.draft." })
    drafts.set("a", "small")
    drafts.set("b", "a much longer draft")
    drafts.set("c", "x".repeat(12))
    expect(drafts.get("c")).toBe("x".repeat(12))
    expect(storage.values.has("ren.draft.b")).toBe(false)
    expect(storage.values.get("ren.draft.a")).toBe("small")
    expect(storage.values.get("ren.theme.v1")).toBe("dark")
  })

  test("a draft that cannot fit stays in memory", () => {
    const storage = quotaStorage(40)
    const drafts = DraftStore.make({ storage, prefix: "ren.draft." })
    drafts.set("a", "y".repeat(100))
    expect(drafts.get("a")).toBe("y".repeat(100))
    expect(storage.values.has("ren.draft.a")).toBe(false)
    drafts.remove("a")
    expect(drafts.get("a")).toBeUndefined()
  })

  test("drafts fall back to memory when storage throws", () => {
    const drafts = DraftStore.make({ storage: brokenStorage, prefix: "ren.draft." })
    expect(drafts.get("a")).toBeUndefined()
    drafts.set("a", "kept")
    expect(drafts.get("a")).toBe("kept")
  })

  test("a draft changed in another tab replaces the memory copy and tells subscribers", () => {
    const storage = quotaStorage(30)
    const events = watcher()
    const drafts = DraftStore.make({ storage, prefix: "ren.draft.", watch: events.watch })
    const changed: Array<string> = []
    const stop = drafts.subscribe?.((key) => changed.push(key))
    drafts.set("a", "z".repeat(40))
    storage.values.set("ren.draft.a", "from the other tab")
    events.emit("ren.draft.a")
    events.emit("ren.theme.v1")
    events.emit(null)
    expect(drafts.get("a")).toBe("from the other tab")
    expect(changed).toEqual(["a"])
    stop?.()
    events.emit("ren.draft.a")
    expect(changed).toEqual(["a"])
  })
})
