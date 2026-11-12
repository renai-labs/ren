export * as Preference from "./preference.js"

import { Option, Schema } from "effect"
import { useSyncExternalStore } from "react"
import { Platform } from "../platform/platform.js"

export function make<A>(key: `${string}.v${number}`, schema: Schema.Codec<A>, fallback: A) {
  const codec = Schema.fromJsonString(schema)
  const decode = Schema.decodeUnknownOption(codec)
  const encode = Schema.encodeSync(codec)
  let last: { readonly raw: string | undefined; readonly value: A } | undefined
  return {
    key,
    decode: (raw: string | undefined) => {
      if (last === undefined || last.raw !== raw) last = { raw, value: Option.getOrElse(decode(raw), () => fallback) }
      return last.value
    },
    read: (storage: Platform.Storage) => Option.getOrElse(decode(storage.get(key)), () => fallback),
    write: (storage: Platform.Storage, value: A) => storage.set(key, encode(value)),
  }
}

type Preference<A> = ReturnType<typeof make<A>>

export function usePreference<A>(preference: Preference<A>) {
  const storage = Platform.usePlatform().storage
  const raw = useSyncExternalStore(
    (listener) => storage.subscribe((key) => (key === null || key === preference.key) && listener()),
    () => storage.get(preference.key),
  )
  return preference.decode(raw)
}

export function useSetPreference() {
  const storage = Platform.usePlatform().storage
  return <A>(preference: Preference<A>, value: A) => preference.write(storage, value)
}
