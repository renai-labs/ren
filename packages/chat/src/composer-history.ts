export * as ComposerHistory from "./composer-history.js"

import { Option, Schema } from "effect"
import { Composer } from "./composer.js"

export const max = 100

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({ text: Schema.String, pasted: Schema.Array(Composer.Pasted) })

const decodeList = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)))
const decodeEntry = Schema.decodeUnknownOption(Entry)
const encodeList = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Entry)))

export const decode = (raw: string | undefined): ReadonlyArray<Entry> =>
  Option.match(decodeList(raw), {
    onNone: () => [],
    onSome: (items) => items.flatMap((item) => Option.toArray(decodeEntry(item))),
  })

export const encode = (entries: ReadonlyArray<Entry>) => encodeList(entries)

const equal = (left: Entry, right: Entry) =>
  left.text === right.text &&
  left.pasted.length === right.pasted.length &&
  left.pasted.every((item, index) => item.text === right.pasted[index]?.text)

export const prepend = (entries: ReadonlyArray<Entry>, entry: Entry, limit = max): ReadonlyArray<Entry> => {
  if (Composer.isBlank(entry)) return entries
  const last = entries.at(0)
  if (last && equal(last, entry)) return entries
  return [{ text: entry.text, pasted: entry.pasted }, ...entries].slice(0, limit)
}

export const remove = (entries: ReadonlyArray<Entry>, entry: Entry) => {
  const next = entries.filter((item) => !equal(item, entry))
  return next.length === entries.length ? entries : next
}

export interface Browsing {
  readonly index: number
  readonly saved?: Entry
}

export const idle: Browsing = { index: -1 }

const allowed = (
  text: string,
  cursor: number,
  browsing: { readonly inHistory: boolean; readonly direction: "up" | "down" },
) => {
  const position = Math.max(0, Math.min(cursor, text.length))
  if (browsing.inHistory) return position === 0 || position === text.length
  return browsing.direction === "up" && position === 0 && text.length === 0
}

export const navigate = (
  browsing: Browsing,
  direction: "up" | "down",
  entries: ReadonlyArray<Entry>,
  current: Entry,
  cursor: number,
): { readonly browsing: Browsing; readonly entry: Entry; readonly cursor: "start" | "end" } | undefined => {
  const inHistory = browsing.index >= 0
  if (!allowed(current.text, cursor, { inHistory, direction })) return undefined
  if (direction === "up") {
    const index = browsing.index + 1
    const entry = entries.at(index)
    if (!entry) return undefined
    const saved = inHistory ? browsing.saved : { text: current.text, pasted: current.pasted }
    return { browsing: { index, ...(saved && { saved }) }, entry, cursor: "start" }
  }
  const index = browsing.index - 1
  const entry = index >= 0 ? entries.at(index) : undefined
  if (entry) return { browsing: { ...browsing, index }, entry, cursor: "end" }
  return { browsing: idle, entry: browsing.saved ?? Composer.empty, cursor: "end" }
}
