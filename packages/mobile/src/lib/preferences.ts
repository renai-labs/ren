export * as Preferences from "./preferences.js"

import { ChatSettings } from "@ren/chat"
import { Option, Schema } from "effect"
import { Storage } from "expo-sqlite/kv-store"
import { useSyncExternalStore } from "react"

export function make<A>(key: `${string}.v${number}`, schema: Schema.Codec<A>, fallback: A) {
  const codec = Schema.fromJsonString(schema)
  const decode = Schema.decodeUnknownOption(codec)
  const encode = Schema.encodeSync(codec)
  const listeners = new Set<() => void>()
  let current: { readonly value: A } | undefined
  return {
    key,
    get: () => {
      current ??= { value: Option.getOrElse(decode(Storage.getItemSync(key)), () => fallback) }
      return current.value
    },
    set: (value: A) => {
      Storage.setItemSync(key, encode(value))
      current = { value }
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export type Info<A> = ReturnType<typeof make<A>>

const from = <A>(setting: ChatSettings.Setting<A>) => make(setting.key, setting.schema, setting.fallback)

export const timelineDetail = from(ChatSettings.timelineDetail)

export const foldTurns = from(ChatSettings.foldTurns)

export const foldMessages = from(ChatSettings.foldMessages)

export const homeSpace = make("chat.home-space.v1", Schema.NullOr(Schema.String), null)

export const themes = ["light", "dark", "system"] as const

export const theme = make("theme.v1", Schema.Literals(themes), "light")

export function usePreference<A>(preference: Info<A>) {
  return [useSyncExternalStore(preference.subscribe, preference.get), preference.set] as const
}
