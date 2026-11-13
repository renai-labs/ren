export * as Preference from "./preference.js"

import { Option, Schema } from "effect"
import { useSyncExternalStore } from "react"
import { Platform } from "../platform/platform.js"

export function make<A>(key: `${string}.v${number}`, schema: Schema.Codec<A>, fallback: A) {
  const codec = Schema.fromJsonString(schema)
  const decode = Schema.decodeUnknownOption(codec)
  const encode = Schema.encodeSync(codec)
  const initial = encode(fallback)
  let last: { readonly raw: string | undefined; readonly value: A; readonly isDefault: boolean } | undefined
  const cached = (raw: string | undefined) => {
    if (last === undefined || last.raw !== raw) {
      const value = Option.getOrElse(decode(raw), () => fallback)
      last = { raw, value, isDefault: encode(value) === initial }
    }
    return last
  }
  return {
    key,
    isDefault: (storage: Platform.Storage) => cached(storage.get(key)).isDefault,
    decode: (raw: string | undefined) => cached(raw).value,
    read: (storage: Platform.Storage) => Option.getOrElse(decode(storage.get(key)), () => fallback),
    write: (storage: Platform.Storage, value: A) => storage.set(key, encode(value)),
  }
}

export type Info<A> = ReturnType<typeof make<A>>

export function usePreference<A>(preference: Info<A>) {
  const storage = Platform.usePlatform().storage
  const raw = useSyncExternalStore(
    (listener) => storage.subscribe((key) => (key === null || key === preference.key) && listener()),
    () => storage.get(preference.key),
  )
  return preference.decode(raw)
}

export function useSetPreference() {
  const storage = Platform.usePlatform().storage
  return <A>(preference: Info<A>, value: A) => preference.write(storage, value)
}

type Resettable = { readonly key: string; readonly isDefault: (storage: Platform.Storage) => boolean }

export function useAllDefault(preferences: ReadonlyArray<Resettable>) {
  const storage = Platform.usePlatform().storage
  return useSyncExternalStore(
    (listener) => storage.subscribe(() => listener()),
    () => preferences.every((preference) => preference.isDefault(storage)),
  )
}

export function useReset(preferences: ReadonlyArray<Resettable>) {
  const storage = Platform.usePlatform().storage
  return () => {
    const previous = preferences.map((preference) => ({ key: preference.key, raw: storage.get(preference.key) }))
    for (const preference of preferences) storage.remove(preference.key)
    return () => {
      for (const item of previous) {
        if (item.raw === undefined) storage.remove(item.key)
        else storage.set(item.key, item.raw)
      }
    }
  }
}
