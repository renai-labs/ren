import { useEffect, useEffectEvent, useRef, useState } from "react"

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
