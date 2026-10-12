export * as Debounce from "./debounce.js"

import { useEffect, useState } from "react"

export function useDebouncedValue<A>(value: A, milliseconds: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), milliseconds)
    return () => clearTimeout(timer)
  }, [value, milliseconds])
  return debounced
}
