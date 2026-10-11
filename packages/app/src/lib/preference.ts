export * as Preference from "./preference.js"

import { Option, Schema } from "effect"
import type { Platform } from "../platform/platform.js"

export function make<A>(key: `${string}.v${number}`, schema: Schema.Codec<A>, fallback: A) {
  const codec = Schema.fromJsonString(schema)
  const decode = Schema.decodeUnknownOption(codec)
  const encode = Schema.encodeSync(codec)
  return {
    key,
    read: (storage: Platform.Storage) => Option.getOrElse(decode(storage.get(key)), () => fallback),
    write: (storage: Platform.Storage, value: A) => storage.set(key, encode(value)),
  }
}
