import { useEffect, useEffectEvent, useState } from "react"
import { Platform } from "../platform/platform.js"
import { ReducedMotion } from "./reduced-motion.js"

const tick = 50
const minimumRate = 60
const catchUpSeconds = 0.8

const wordEnd = (text: string, from: number) => {
  const next = text.slice(from).search(/\s/u)
  return next === -1 ? text.length : from + next
}

// oxlint-disable-next-line ren/no-comments -- Reveals streamed text a few words at a time. Text that was there when it mounted shows at once, so a chat opened mid-stream does not replay it. The reveal runs on animation frames, which pause in a background tab, and the whole text shows on return, when the stream ends and under reduced motion.
export function useSmoothText(text: string, options: { streaming: boolean }) {
  const reduced = ReducedMotion.useReduced()
  const onLifecycle = Platform.usePlatform().onLifecycle
  const [shown, setShown] = useState(text.length)
  const instant = !options.streaming || reduced
  const behind = !instant && shown < text.length
  const reveal = useEffectEvent((elapsed: number) =>
    setShown((current) => {
      const backlog = text.length - current
      if (backlog <= 0) return text.length
      const rate = Math.max(minimumRate, backlog / catchUpSeconds)
      return Math.min(text.length, wordEnd(text, current + Math.ceil((rate * elapsed) / 1000)))
    }),
  )
  const showAll = useEffectEvent(() => setShown(text.length))
  useEffect(() => {
    if (!behind) return
    const state = { frame: 0, last: performance.now() }
    const step = (now: number) => {
      const elapsed = now - state.last
      if (elapsed >= tick) {
        state.last = now
        reveal(elapsed)
      }
      state.frame = requestAnimationFrame(step)
    }
    state.frame = requestAnimationFrame(step)
    const off = onLifecycle?.((event) => {
      if (event === "foreground") showAll()
    })
    return () => {
      cancelAnimationFrame(state.frame)
      off?.()
    }
  }, [behind, onLifecycle])
  if (instant) return text
  return behind ? text.slice(0, shown) : text
}
