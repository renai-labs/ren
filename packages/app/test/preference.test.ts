import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Preference } from "../src/lib/preference.js"
import type { Platform } from "../src/platform/platform.js"

const memoryStorage = (): Platform.Storage => {
  const values = new Map<string, string>()
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  }
}

const density = Preference.make("density.v1", Schema.Literals(["compact", "comfortable"]), "comfortable")

test("a preference falls back when storage is empty or holds an invalid value", () => {
  const storage = memoryStorage()
  expect(density.read(storage)).toBe("comfortable")
  storage.set(density.key, '"spacious"')
  expect(density.read(storage)).toBe("comfortable")
  storage.set(density.key, "not json")
  expect(density.read(storage)).toBe("comfortable")
})

test("a preference round-trips through storage", () => {
  const storage = memoryStorage()
  density.write(storage, "compact")
  expect(storage.get(density.key)).toBe('"compact"')
  expect(density.read(storage)).toBe("compact")
})
