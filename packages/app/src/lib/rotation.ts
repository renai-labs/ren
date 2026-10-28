export * as Rotation from "./rotation.js"

import { useEffect, useState } from "react"

export function useStep(count: number, interval: number) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (index >= count - 1) return
    const timer = setTimeout(() => setIndex(index + 1), interval)
    return () => clearTimeout(timer)
  }, [index, count, interval])

  return index
}
