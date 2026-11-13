export * as Platform from "./platform.js"

import { createContext, use } from "react"
import type { ReactNode } from "react"
import type { Analytics } from "./analytics.js"

export interface Storage {
  readonly get: (key: string) => string | undefined
  readonly set: (key: string, value: string) => void
  readonly remove: (key: string) => void
}

export interface Drafts extends Storage {
  readonly subscribe?: (listener: (key: string) => void) => () => void
}

export interface ChatCache {
  readonly read: (userId: string, sessionID: string) => Promise<string | void>
  readonly write: (
    userId: string,
    sessionID: string,
    entry: { readonly body: string; readonly tier: number },
  ) => Promise<void>
  readonly remove: (userId: string, sessionID: string) => Promise<void>
  readonly forget: (keep?: string) => Promise<void>
}

export interface NotifyOptions {
  readonly id: string
  readonly silent: boolean
  readonly active?: () => boolean
  readonly onClick: () => void
}

interface Base {
  readonly serverUrl: string
  readonly appUrl: string
  readonly storage: Storage
  readonly drafts?: Drafts
  readonly chatCache?: ChatCache
  readonly openExternal: (url: string) => void
  readonly redirect?: (url: string) => void
  readonly blankTab?: () => Window | null
  readonly blankPopup?: () => Window | null
  readonly notify: (title: string, body: string, options: NotifyOptions) => Promise<void>
  readonly notificationPermission?: () => NotificationPermission | "unsupported"
  readonly requestNotifications?: () => Promise<boolean>
  readonly fetch?: typeof globalThis.fetch
  readonly upload?: (
    form: { readonly uploadUrl: string; readonly fields: Readonly<Record<string, string>> },
    file: Blob,
    signal: AbortSignal,
  ) => Promise<void>
  readonly writeClipboardText?: (text: string) => Promise<void>
  readonly authorizationQuery?: string | undefined
  readonly onLifecycle?: (listener: (event: "foreground" | "online") => void) => () => void
  readonly analytics?: Analytics.Interface
}

export type Info =
  | (Base & { readonly platform: "web" })
  | (Base & { readonly platform: "desktop"; readonly os: "macos" | "windows" | "linux" })
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
