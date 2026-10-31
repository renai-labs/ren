export * as Keyboard from "./keyboard.js"

import { useEffect, useEffectEvent } from "react"

export function useKeyDown(listener: (event: KeyboardEvent) => void) {
  const onKeyDown = useEffectEvent(listener)
  useEffect(() => {
    const handle = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener("keydown", handle)
    return () => document.removeEventListener("keydown", handle)
  }, [])
}
