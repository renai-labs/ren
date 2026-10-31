import { useEffect, useState } from "react"

export function useStep(options: { readonly last: number; readonly everyMs: number }) {
  const [index, setIndex] = useState(0)
  const last = options.last
  const everyMs = options.everyMs
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => Math.min(current + 1, last)), everyMs)
    return () => window.clearInterval(timer)
  }, [last, everyMs])
  return index
}
