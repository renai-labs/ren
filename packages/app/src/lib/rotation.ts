export * as Rotation from "./rotation.js"

import { useEffect, useState } from "react"

export function useStep(count: number, interval: number) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => Math.min(current + 1, count - 1)), interval)
    return () => clearInterval(timer)
  }, [count, interval])

  return index
}
