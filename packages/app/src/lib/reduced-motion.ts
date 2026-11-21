export * as ReducedMotion from "./reduced-motion.js"

import { useSyncExternalStore } from "react"

const query = "(prefers-reduced-motion: reduce)"

const subscribe = (onChange: () => void) => {
  const media = matchMedia(query)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

export const use = () =>
  useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  )
