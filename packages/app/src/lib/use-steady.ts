import { useEffect, useEffectEvent, useRef, useState } from "react"

// oxlint-disable-next-line ren/no-comments -- Holds each value on screen for at least `minMs`, then shows the newest one, so a burst of quick changes reads as a few steady steps instead of a flicker. The value is taken when it arrives, so a step that ends within one update still shows.
export function useSteady<A>(value: A, options: { readonly key: (value: A) => string; readonly minMs: number }) {
  const [shown, setShown] = useState(value)
  const since = useRef(0)
  const key = options.key(value)
  const shownKey = options.key(shown)
  const minMs = options.minMs
  const latest = useEffectEvent(() => value)
  useEffect(() => {
    since.current = performance.now()
  }, [])
  useEffect(() => {
    if (key === shownKey) return
    const next = latest()
    const wait = Math.max(0, since.current + minMs - performance.now())
    const timer = window.setTimeout(() => {
      since.current = performance.now()
      setShown(next)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [key, shownKey, minMs])
  return key === shownKey ? value : shown
}
