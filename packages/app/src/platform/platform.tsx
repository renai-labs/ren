export * as Platform from "./platform.js"

import { createContext, use } from "react"
import type { ReactNode } from "react"

export interface Storage {
  readonly get: (key: string) => string | undefined
  readonly set: (key: string, value: string) => void
  readonly remove: (key: string) => void
}

interface Base {
  readonly version: string
  readonly serverUrl: string
  readonly appUrl: string
  readonly storage: Storage
  readonly drafts?: Storage
  readonly openExternal: (url: string) => void
  readonly notify: (title: string, body?: string) => Promise<void>
  readonly fetch?: typeof globalThis.fetch
  readonly writeClipboardText?: (text: string) => Promise<void>
  readonly readClipboardImage?: () => Promise<File | undefined>
  readonly onLifecycle?: (listener: (event: "foreground" | "online") => void) => () => void
}

export type Info =
  | (Base & { readonly platform: "web" })
  | (Base & {
      readonly platform: "desktop"
      readonly os: "macos" | "windows" | "linux"
      readonly openDirectoryPicker: () => Promise<string | undefined>
      readonly revealPath: (path: string) => Promise<void>
    })
  | (Base & { readonly platform: "mobile"; readonly os: "ios" | "android" })

const Context = createContext<Info | null>(null)

export function Provider(props: { value: Info; children: ReactNode }) {
  return <Context value={props.value}>{props.children}</Context>
}

export function usePlatform() {
  const value = use(Context)
  if (value === null) throw new Error("usePlatform must be used inside Platform.Provider")
  return value
}
