export * as Countdown from "./countdown.js"

import { useEffect, useState } from "react"

export function useCountdown(seconds: number) {
  const [deadline, setDeadline] = useState(() => Date.now() + seconds * 1000)
  return {
    remaining: Math.min(seconds, useUntil(deadline)),
    restart: () => setDeadline(Date.now() + seconds * 1000),
  }
}

export function useUntil(deadline: number) {
  const [now, setNow] = useState(() => Date.now())
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))

  useEffect(() => {
    if (remaining === 0) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [remaining])

  return remaining
}
