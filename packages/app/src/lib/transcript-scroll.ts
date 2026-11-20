export * as TranscriptScroll from "./transcript-scroll.js"

import { startTransition, useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject } from "react"

export interface Spot {
  readonly row: string
  readonly offset: number
}

const places = new Map<string, ReadonlyArray<Spot> | undefined>()

const bottomSlack = 8

export const atBottom = (viewport: HTMLElement) =>
  viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= bottomSlack

export const placeOf = (sessionID: string) => places.get(sessionID)

export const keepPlace = (sessionID: string, viewport: HTMLElement) => {
  if (atBottom(viewport)) {
    places.set(sessionID, undefined)
    return
  }
  const top = viewport.getBoundingClientRect().top
  const rows = [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")].filter((row) => {
    const id = row.dataset.messageId ?? ""
    return id !== "working" && !id.startsWith("live:") && row.getBoundingClientRect().bottom > top + 1
  })
  const spots = rows
    .slice(0, 3)
    .flatMap((row) =>
      row.dataset.messageId ? [{ row: row.dataset.messageId, offset: row.getBoundingClientRect().top - top }] : [],
    )
  places.set(sessionID, spots.length > 0 ? spots : undefined)
}

const rowOf = (blocks: ReadonlyArray<{ readonly key: string }>, place: ReadonlyArray<Spot>) => {
  const indexes = new Map(blocks.map((block, index) => [block.key, index]))
  const found = place.flatMap((spot) => indexes.get(spot.row) ?? [])
  return found.length > 0 ? Math.min(...found) : -1
}

const firstRows = 12

export function useOpening(
  blocks: ReadonlyArray<{ readonly key: string }>,
  options: { readonly all: boolean; readonly place: ReadonlyArray<Spot> | undefined },
) {
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    startTransition(() => setOpened(true))
  }, [])
  const at = options.place ? rowOf(blocks, options.place) : blocks.length
  if (opened || options.all || at === -1) return 0
  return Math.max(0, Math.min(at, blocks.length - firstRows))
}

const placeInputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const

const givingUpMs = 3000

const settleMs = 200

export function useKeptPlace(
  viewport: RefObject<HTMLDivElement | null>,
  place: ReadonlyArray<Spot> | undefined,
  options: {
    readonly session: string
    readonly following: boolean
    readonly more: boolean
    readonly loading: boolean
    readonly onLoadMore: () => void
  },
) {
  const older = useEffectEvent(() => {
    if (options.more && !options.loading) options.onLoadMore()
  })
  const free = useEffectEvent(() => !options.following)
  const session = options.session
  useLayoutEffect(() => {
    const element = viewport.current
    const content = element?.querySelector("[data-slot=message-scroller-content]")
    if (!element || !content) return
    const opening = { place }
    const motion = { moving: false, timer: 0, top: element.scrollTop }
    const still = () => {
      motion.moving = false
    }
    const moved = () => {
      motion.top = element.scrollTop
      motion.moving = true
      window.clearTimeout(motion.timer)
      motion.timer = window.setTimeout(still, settleMs)
    }
    element.addEventListener("scroll", moved, { passive: true })
    element.addEventListener("scrollend", still)
    const reveal = () => element.removeAttribute("data-placing")
    const hold = () => {
      if (!opening.place && Math.abs(element.scrollTop - motion.top) > 1) return moved()
      const spots = opening.place ?? (free() && !motion.moving ? places.get(session) : undefined)
      if (!spots) return
      const rows = [...element.querySelectorAll<HTMLElement>("[data-message-id]")]
      const spot = spots.find((each) => rows.some((row) => row.dataset.messageId === each.row))
      const row = spot && rows.find((each) => each.dataset.messageId === spot.row)
      if (!spot || !row) {
        if (element.hasAttribute("data-placing")) older()
        return
      }
      const delta = row.getBoundingClientRect().top - element.getBoundingClientRect().top - spot.offset
      // ast-grep-ignore: no-manual-scroll -- puts a reopened chat back where it was read, which MessageScroller has no API for
      if (Math.abs(delta) > 0.5) element.scrollBy({ top: delta })
      motion.top = element.scrollTop
      reveal()
    }
    if (place) element.setAttribute("data-placing", "")
    hold()
    // ast-grep-ignore: no-manual-scroll -- keeps that place while the rows above it load and grow
    const observer = new ResizeObserver(hold)
    observer.observe(content)
    observer.observe(element)
    const timer = window.setTimeout(reveal, givingUpMs)
    const settle = () => {
      opening.place = undefined
      window.clearTimeout(timer)
      reveal()
      for (const type of placeInputs) window.removeEventListener(type, settle, { capture: true })
    }
    for (const type of placeInputs) window.addEventListener(type, settle, { capture: true, passive: true })
    return () => {
      settle()
      observer.disconnect()
      window.clearTimeout(motion.timer)
      element.removeEventListener("scroll", moved)
      element.removeEventListener("scrollend", still)
    }
  }, [viewport, place, session])
}

const glideMs = 600

export function useSendGlide(sent: string | undefined) {
  const [gliding, setGliding] = useState<string>()
  const [seen, setSeen] = useState(sent)
  if (sent !== seen) {
    setSeen(sent)
    setGliding(sent)
  }
  useEffect(() => {
    if (!gliding) return
    const timer = window.setTimeout(() => setGliding(undefined), glideMs)
    return () => window.clearTimeout(timer)
  }, [gliding])
  return gliding ? "" : undefined
}

export function useOnSent(sent: string | undefined, onSent: () => void) {
  const run = useEffectEvent(onSent)
  useEffect(() => {
    if (sent) run()
  }, [sent])
}
