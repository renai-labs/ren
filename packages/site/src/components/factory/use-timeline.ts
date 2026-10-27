import { animate, useReducedMotion, type AnimationPlaybackControls } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { DAY, HOUR } from "../../lib/factory/time.js"

export type TimelineMode = "live" | "paused" | "playing"
export const SPEEDS = [0.5, 1, 2, 4, 8] as const
export type Speed = (typeof SPEEDS)[number]
const PLAYBACK_HOURS_PER_SECOND = 1 / 3600
export const SNAP = 6 * HOUR
const ARROWS = new Map<string, -1 | 1>([
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
])

export type TimelineOptions = {
  playFrom?: number
  speed?: number
  keyboard?: boolean
  loop?: boolean
  maxIdleMs?: number
}

function firstAfter(moments: readonly number[], t: number) {
  let lo = 0
  let hi = moments.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((moments[mid] ?? Number.POSITIVE_INFINITY) > t) hi = mid
    else lo = mid + 1
  }
  return moments[lo]
}

function isEditable(target: HTMLElement | null) {
  return Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable))
}

function handlesSpace(target: HTMLElement | null) {
  return Boolean(target && (target.tagName === "BUTTON" || target.getAttribute("role") === "link"))
}

export function useTimeline(start: number, now: number, options: TimelineOptions = {}, moments?: readonly number[]) {
  const keyboard = options.keyboard ?? true
  const momentsRef = useRef(moments)
  const optionsRef = useRef(options)
  useEffect(() => {
    momentsRef.current = moments
    optionsRef.current = options
  })
  const reduceMotion = useReducedMotion()
  const [mode, setMode] = useState<TimelineMode>(() =>
    options.playFrom && options.playFrom < Date.now() ? "playing" : "live",
  )
  const [at, setAt] = useState(() => Math.max(start, Math.min(Date.now(), options.playFrom ?? Date.now())))
  const [speed, setSpeed] = useState<number>(options.speed ?? 1)
  const [scrubbing, setScrubbing] = useState(false)
  const [animating, setAnimating] = useState(false)
  const [overshoot, setOvershoot] = useState(0)
  const atRef = useRef(at)
  const modeRef = useRef(mode)
  const controls = useRef<AnimationPlaybackControls | null>(null)
  const overshootControls = useRef<AnimationPlaybackControls | null>(null)

  const moveTo = useCallback((value: number) => {
    atRef.current = value
    setAt(value)
  }, [])
  const switchMode = useCallback((value: TimelineMode) => {
    modeRef.current = value
    setMode(value)
  }, [])

  const current = useCallback(() => (modeRef.current === "live" ? Date.now() : atRef.current), [])
  const clamp = useCallback((t: number) => Math.min(Date.now(), Math.max(start, t)), [start])

  const stop = useCallback(() => {
    controls.current?.stop()
    controls.current = null
    setAnimating(false)
  }, [])

  const goLiveNow = useCallback(() => {
    stop()
    moveTo(Date.now())
    switchMode("live")
  }, [moveTo, switchMode, stop])

  const seek = useCallback(
    (t: number) => {
      stop()
      const value = clamp(t)
      moveTo(value)
      switchMode(value >= Date.now() - 1000 && modeRef.current !== "paused" ? "live" : "paused")
    },
    [clamp, moveTo, switchMode, stop],
  )

  const pauseAt = useCallback(
    (t: number) => {
      stop()
      moveTo(clamp(t))
      switchMode("paused")
    },
    [clamp, moveTo, switchMode, stop],
  )

  const springTo = useCallback(
    (target: number, spring: { bounce: number; velocity?: number; thenLive?: boolean }) => {
      stop()
      const from = current()
      const goal = clamp(target)
      switchMode("paused")
      if (reduceMotion || from === goal) {
        moveTo(goal)
        if (spring.thenLive) switchMode("live")
        return
      }
      moveTo(from)
      setAnimating(true)
      controls.current = animate(from, goal, {
        type: "spring",
        duration: 0.4,
        bounce: spring.bounce,
        velocity: spring.velocity ?? 0,
        onUpdate: (value) => moveTo(value),
        onComplete: () => {
          controls.current = null
          setAnimating(false)
          if (spring.thenLive) goLiveNow()
        },
      })
    },
    [clamp, current, goLiveNow, reduceMotion, moveTo, switchMode, stop],
  )

  const goLive = useCallback(
    (animated: boolean) => {
      if (modeRef.current === "live") return
      if (!animated) return goLiveNow()
      springTo(Date.now(), { bounce: 0, thenLive: true })
    },
    [goLiveNow, springTo],
  )

  const step = useCallback(
    (direction: -1 | 1, amount: number, motion: { animated: boolean }) => {
      const target = current() + direction * amount
      if (direction > 0 && target >= Date.now()) return goLive(motion.animated)
      if (motion.animated) springTo(target, { bounce: 0 })
      else pauseAt(target)
    },
    [current, goLive, pauseAt, springTo],
  )

  const togglePlay = useCallback(() => {
    if (modeRef.current === "playing") return pauseAt(atRef.current)
    if (modeRef.current === "live") return pauseAt(Date.now())
    if (atRef.current >= Date.now() - 60_000) return goLiveNow()
    stop()
    switchMode("playing")
  }, [goLiveNow, pauseAt, switchMode, stop])

  useEffect(() => {
    if (mode !== "playing") return
    let frame = 0
    let last = performance.now()
    const tick = (time: number) => {
      const dt = time - last
      last = time
      const perMs = (speed * PLAYBACK_HOURS_PER_SECOND * HOUR) / 1000
      let next = atRef.current + dt * perMs
      const latest = optionsRef.current
      const list = momentsRef.current
      if (list && typeof latest.maxIdleMs === "number") {
        const upcoming = Math.min(firstAfter(list, atRef.current) ?? Number.POSITIVE_INFINITY, Date.now())
        const lead = latest.maxIdleMs * perMs
        if (upcoming - next > lead) next = upcoming - lead
      }
      if (next >= Date.now()) {
        if (latest.loop && latest.playFrom) {
          moveTo(Math.max(start, latest.playFrom))
          frame = requestAnimationFrame(tick)
          return
        }
        goLiveNow()
        return
      }
      moveTo(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [goLiveNow, mode, moveTo, speed, start])

  const springOvershoot = useCallback(
    (from: number) => {
      overshootControls.current?.stop()
      if (reduceMotion) return setOvershoot(0)
      overshootControls.current = animate(from, 0, {
        type: "spring",
        duration: 0.4,
        bounce: 0,
        onUpdate: setOvershoot,
      })
    },
    [reduceMotion],
  )

  useEffect(() => {
    if (!keyboard) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(target)) return
      const direction = ARROWS.get(event.key)
      if (direction) {
        event.preventDefault()
        step(direction, event.shiftKey ? DAY : SNAP, { animated: false })
        return
      }
      if (event.key === " ") {
        if (handlesSpace(target)) return
        event.preventDefault()
        togglePlay()
        return
      }
      if (event.key.toLowerCase() === "l") goLive(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [goLive, keyboard, step, togglePlay])

  return {
    mode,
    at: mode === "live" ? now : at,
    speed,
    setSpeed,
    scrubbing,
    setScrubbing,
    animating,
    overshoot,
    setOvershoot,
    springOvershoot,
    seek,
    pauseAt,
    springTo,
    goLive,
    step,
    togglePlay,
    start,
    stop,
  }
}

export type TimelineController = ReturnType<typeof useTimeline>
