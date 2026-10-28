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

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)

export function isTyping(event: KeyboardEvent) {
  return editable(event.target)
}

const covered = (input: {
  readonly editing: boolean
  readonly layoutHeight: number
  readonly viewportHeight: number
  readonly scale: number
}) => input.editing && input.layoutHeight - input.viewportHeight * input.scale > 100

export function trackInsets() {
  const viewport = window.visualViewport
  if (!viewport) return
  const update = () => {
    const open = covered({
      editing: editable(document.activeElement),
      layoutHeight: document.documentElement.clientHeight,
      viewportHeight: viewport.height,
      scale: viewport.scale,
    })
    if (open) document.body.style.setProperty("padding-bottom", "0px")
    else document.body.style.removeProperty("padding-bottom")
  }
  viewport.addEventListener("resize", update)
  window.addEventListener("resize", update)
  document.addEventListener("focusin", update)
  document.addEventListener("focusout", update)
}

export function fromPage(event: KeyboardEvent) {
  return event.target === document.body || event.target === document.documentElement
}

export function isPrintable(event: KeyboardEvent) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
}
