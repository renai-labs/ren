export * as DarkUi from "./dark-ui.js"

import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()

let observing = false

function subscribe(listener: () => void) {
  if (!observing) {
    observing = true
    new MutationObserver(() => listeners.forEach((notify) => notify())).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const isDark = () => document.documentElement.classList.contains("dark")

export function useDarkUi() {
  return useSyncExternalStore(subscribe, isDark)
}
