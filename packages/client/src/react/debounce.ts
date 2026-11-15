export * as Debounce from "./debounce.js"

import { useEffect, useState } from "react"

export function useValue<Value>(value: Value, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
