import { useEffect, useState, useSyncExternalStore } from "react"

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const BUFFER_MS = 240
const RENDER_INTERVAL_MS = 32
const MIN_CHARACTERS_PER_SECOND = 45
const CATCH_UP_SECONDS = 1.2
const RATE_SMOOTHING_MS = 600
const STREAMING_REVEAL_MS = 360

function nextVisibleLength(text: string, current: number, budget: number) {
  const state = { next: current }
  for (const part of segmenter.segment(text.slice(current))) {
    const end = current + part.index + part.segment.length
    if (end > budget) break
    state.next = end
  }
  return state.next
}

function createStreamingText(text: string, streaming: boolean) {
  const state: {
    target: string
    visible: string
    cursor: number
    frame: number | undefined
    previousTime: number | undefined
    sinceRender: number
    buffered: number
    rate: number
  } = {
    target: text,
    visible: streaming ? "" : text,
    cursor: streaming ? 0 : text.length,
    frame: undefined,
    previousTime: undefined,
    sinceRender: 0,
    buffered: 0,
    rate: MIN_CHARACTERS_PER_SECOND,
  }
  const listeners = new Set<() => void>()

  function publish(next: string) {
    if (state.visible === next) return
    state.visible = next
    for (const listener of listeners) listener()
  }

  function stop() {
    if (state.frame !== undefined) cancelAnimationFrame(state.frame)
    state.frame = undefined
    state.previousTime = undefined
    state.buffered = 0
    state.sinceRender = 0
    state.rate = MIN_CHARACTERS_PER_SECOND
    state.cursor = state.visible.length
  }

  function tick(now: number) {
    state.frame = undefined
    const elapsed = state.previousTime === undefined ? 0 : Math.min(Math.max(now - state.previousTime, 0), 64)
    state.previousTime = now
    state.buffered += elapsed
    if (state.buffered >= BUFFER_MS) {
      const desiredRate = Math.max(MIN_CHARACTERS_PER_SECOND, (state.target.length - state.cursor) / CATCH_UP_SECONDS)
      state.rate += (desiredRate - state.rate) * (1 - Math.exp(-elapsed / RATE_SMOOTHING_MS))
      state.cursor = Math.min(state.target.length, state.cursor + (state.rate * elapsed) / 1000)
      state.sinceRender += elapsed
      if (state.sinceRender >= RENDER_INTERVAL_MS || state.cursor === state.target.length) {
        state.sinceRender = 0
        publish(state.target.slice(0, nextVisibleLength(state.target, state.visible.length, Math.floor(state.cursor))))
      }
    }
    if (state.visible.length < state.target.length) state.frame = requestAnimationFrame(tick)
    else stop()
  }

  return {
    getSnapshot: () => state.visible,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next: string, isStreaming: boolean, immediate: boolean) {
      const appended = next.startsWith(state.target)
      state.target = next
      if (immediate || !appended || (!isStreaming && state.frame === undefined)) {
        stop()
        state.cursor = next.length
        publish(next)
        return
      }
      if (state.visible.length < state.target.length && state.frame === undefined)
        state.frame = requestAnimationFrame(tick)
    },
    stop,
  }
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)"

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia(reducedMotionQuery)
  query.addEventListener("change", listener)
  return () => query.removeEventListener("change", listener)
}

function readReducedMotion() {
  return window.matchMedia(reducedMotionQuery).matches
}

export function useStreamingText(text: string, streaming: boolean) {
  const immediate = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => true)
  // oxlint-disable-next-line react/hook-use-state -- the store is created once per mount and never replaced
  const [store] = useState(() => createStreamingText(text, streaming && !immediate))
  const visible = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    store.update(text, streaming, immediate)
  }, [store, text, streaming, immediate])

  useEffect(() => () => store.stop(), [store])

  const revealing = streaming || visible !== text
  const [settledText, setSettledText] = useState(streaming && !immediate ? "" : text)

  useEffect(() => {
    if (revealing || immediate) return
    const timer = setTimeout(() => setSettledText(text), STREAMING_REVEAL_MS)
    return () => clearTimeout(timer)
  }, [revealing, immediate, text])

  return {
    visible,
    animating: revealing || (!immediate && settledText !== text),
    animateText: !immediate,
  }
}
