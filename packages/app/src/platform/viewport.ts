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

export const height = {
  height: () => window.innerHeight,
  subscribe: (listener: () => void) => {
    window.addEventListener("resize", listener)
    return () => window.removeEventListener("resize", listener)
  },
}

export const apple = /Mac|iPhone|iPad/.test(navigator.userAgent)

export function shortcut(key: string) {
  return apple ? `⌘${key}` : `Ctrl+${key}`
}
