import { describe, expect, test } from "bun:test"
import { DraftChunks } from "./draft-chunks.js"
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

const tabs = () => {
  const handlers = {
    a: new Set<(message: DraftStore.Shared) => void>(),
    b: new Set<(message: DraftStore.Shared) => void>(),
  }
  const endpoint = (
    own: Set<(message: DraftStore.Shared) => void>,
    other: Set<(message: DraftStore.Shared) => void>,
  ) => ({
    post: (message: DraftStore.Shared) => {
      for (const handler of other) handler(message)
    },
    listen: (handler: (message: DraftStore.Shared) => void) => {
      own.add(handler)
      return () => void own.delete(handler)
    },
  })
  return { a: endpoint(handlers.a, handlers.b), b: endpoint(handlers.b, handlers.a) }
}

const chunkStore = (loaded: ReadonlyMap<string, string> = new Map()) => {
  const writes: Array<{ key: string; count: number; indices: ReadonlyArray<number> }> = []
  const removed: Array<string> = []
  const failing: { next: boolean; written: Promise<void> } = { next: false, written: Promise.resolve() }
  return {
    writes,
    removed,
    failing,
    large: {
      loaded,
      write: (key: string, count: number, chunks: ReadonlyArray<{ index: number; text: string }>) => {
        writes.push({ key, count, indices: chunks.map((chunk) => chunk.index) })
        failing.written = failing.next
          ? Promise.reject(new DOMException("The quota has been exceeded.", "QuotaExceededError"))
          : Promise.resolve()
        failing.next = false
        return failing.written
      },
      remove: (key: string) => {
        removed.push(key)
        return Promise.resolve()
      },
    },
  }
}

const paste = "p".repeat(3 * DraftChunks.size)

describe("DraftStore", () => {
  test("a large draft goes to the chunk store, and typing after it rewrites only the last chunk", () => {
    const storage = quotaStorage(1_000_000)
    const chunks = chunkStore()
    const drafts = DraftStore.make({ storage, prefix: "ren.draft.", large: chunks.large })
    drafts.set("a", "short")
    drafts.set("a", paste)
    expect(drafts.get("a")).toBe(paste)
    expect(storage.values.has("ren.draft.a")).toBe(false)
    drafts.set("a", `${paste}!`)
    expect(chunks.writes).toEqual([
      { key: "a", count: 3, indices: [0, 1, 2] },
      { key: "a", count: 4, indices: [3] },
    ])
    drafts.set("a", "short again")
    expect(chunks.removed).toEqual(["a"])
    expect(storage.values.get("ren.draft.a")).toBe("short again")
  })

  test("a large draft loaded before the first render reads back at once", () => {
    const chunks = chunkStore(new Map([["a", paste]]))
    const drafts = DraftStore.make({ storage: quotaStorage(100), prefix: "ren.draft.", large: chunks.large })
    expect(drafts.get("a")).toBe(paste)
    drafts.set("a", `${paste}!`)
    expect(chunks.writes).toEqual([{ key: "a", count: 4, indices: [3] }])
    drafts.remove("a")
    expect(drafts.get("a")).toBeUndefined()
    expect(chunks.removed).toEqual(["a"])
  })

  test("a failed chunk write is retried in full on the next save", async () => {
    const chunks = chunkStore()
    const drafts = DraftStore.make({ storage: quotaStorage(100), prefix: "ren.draft.", large: chunks.large })
    chunks.failing.next = true
    drafts.set("a", paste)
    await chunks.failing.written.catch(() => undefined)
    drafts.set("a", `${paste}!`)
    expect(drafts.get("a")).toBe(`${paste}!`)
    expect(chunks.writes.at(-1)).toEqual({ key: "a", count: 4, indices: [0, 1, 2, 3] })
  })

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

  test("a large draft typed in one tab reads back in another, until it is removed", () => {
    const storage = quotaStorage(1_000_000)
    const link = tabs()
    const events = watcher()
    const first = DraftStore.make({ storage, prefix: "ren.draft.", large: chunkStore().large, share: link.a })
    const second = DraftStore.make({
      storage,
      prefix: "ren.draft.",
      large: chunkStore().large,
      share: link.b,
      watch: events.watch,
    })
    const changed: Array<string> = []
    const stop = second.subscribe?.((key) => changed.push(key))
    first.set("a", "short")
    events.emit("ren.draft.a")
    first.set("a", paste)
    events.emit("ren.draft.a")
    expect(second.get("a")).toBe(paste)
    first.remove("a")
    expect(second.get("a")).toBeUndefined()
    expect(changed).toEqual(["a", "a", "a", "a"])
    stop?.()
  })

  test("a draft changed in another tab replaces a large draft held here", () => {
    const storage = quotaStorage(1_000_000)
    const events = watcher()
    const drafts = DraftStore.make({
      storage,
      prefix: "ren.draft.",
      watch: events.watch,
      large: chunkStore(new Map([["a", paste]])).large,
    })
    const stop = drafts.subscribe?.(() => undefined)
    storage.values.set("ren.draft.a", "from the other tab")
    events.emit("ren.draft.a")
    expect(drafts.get("a")).toBe("from the other tab")
    stop?.()
  })
})
