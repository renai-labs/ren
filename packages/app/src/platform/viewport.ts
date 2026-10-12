export * as Viewport from "./viewport.js"

import { useSyncExternalStore } from "react"

const query = "(max-width: 767px)"

const subscribe = (listener: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener("change", listener)
  return () => media.removeEventListener("change", listener)
}

export function useMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

const apple = /Mac|iPhone|iPad/.test(navigator.userAgent)

export function shortcut(key: string) {
  return apple ? `⌘${key}` : `Ctrl+${key}`
}
