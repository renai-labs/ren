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

export function isTyping(event: KeyboardEvent) {
  const target = event.target
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  )
}

export function fromPage(event: KeyboardEvent) {
  return event.target === document.body || event.target === document.documentElement
}

export function isPrintable(event: KeyboardEvent) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
}
