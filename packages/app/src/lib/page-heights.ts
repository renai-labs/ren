export * as PageHeights from "./page-heights.js"

import { Schema } from "effect"
import type { Platform } from "../platform/platform.js"
import { Preference } from "./preference.js"

const kept = 200

const stored = Preference.make("chat.page-heights.v1", Schema.Record(Schema.String, Schema.Number), {})

const memory = new Map<string, number>()

export const get = (storage: Platform.Storage, id: string) => memory.get(id) ?? stored.read(storage)[id]

export const set = (storage: Platform.Storage, id: string, height: number) => {
  if (memory.get(id) === height) return
  memory.set(id, height)
  const others = Object.entries(stored.read(storage)).filter((entry) => entry[0] !== id)
  stored.write(storage, Object.fromEntries([...others.slice(Math.max(0, others.length - kept + 1)), [id, height]]))
}
