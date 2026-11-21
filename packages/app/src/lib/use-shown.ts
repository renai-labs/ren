import { useState } from "react"
import { pageSize } from "./pagination.js"

export function useShown<T>(items: ReadonlyArray<T>) {
  const [count, setCount] = useState(pageSize)
  return {
    items: items.slice(0, count),
    more: items.length > count,
    next: () => setCount((previous) => previous + pageSize),
  }
}
