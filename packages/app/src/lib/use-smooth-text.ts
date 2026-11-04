import { useEffect, useState } from "react"

const tick = 50
const minimumRate = 60
const catchUpSeconds = 0.8
const finishSeconds = 0.25

const wordEnd = (text: string, from: number) => {
  const next = text.slice(from).search(/\s/u)
  return next === -1 ? text.length : from + next
}

export function useSmoothText(text: string, options: { streaming: boolean }) {
  const streaming = options.streaming
  const [shown, setShown] = useState(text.length)
  const behind = shown < text.length
  useEffect(() => {
    if (!behind) return
    const timer = setInterval(() => {
      setShown((current) => {
        const backlog = text.length - current
        if (backlog <= 0) return text.length
        const rate = Math.max(minimumRate, backlog / (streaming ? catchUpSeconds : finishSeconds))
        return Math.min(text.length, wordEnd(text, current + Math.ceil((rate * tick) / 1000)))
      })
    }, tick)
    return () => clearInterval(timer)
  }, [behind, text, streaming])
  return behind ? text.slice(0, shown) : text
}
