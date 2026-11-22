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

// oxlint-disable-next-line ren/no-comments -- Restoring: a reopened chat goes back to where it was read, holding that place while the rows above it load, even when MessageScroller first puts the view at the end, until the person scrolls or three seconds pass. Then it hands over to reading and writes the scroll no more; CSS scroll anchoring keeps the place after that.
export function useKeptPlace(
  viewport: RefObject<HTMLDivElement | null>,
  place: ReadonlyArray<Spot> | undefined,
  options: {
    readonly session: string
    readonly more: boolean
    readonly loading: boolean
    readonly onLoadMore: () => void
  },
) {
  const older = useEffectEvent(() => {
    if (options.more && !options.loading) options.onLoadMore()
  })
  const session = options.session
  useLayoutEffect(() => {
    const element = viewport.current
    const content = element?.querySelector("[data-slot=message-scroller-content]")
    if (!element || !content || !place) return
    const reveal = () => element.removeAttribute("data-placing")
    const hold = () => {
      const rows = [...element.querySelectorAll<HTMLElement>("[data-message-id]")]
      const spot = place.find((each) => rows.some((row) => row.dataset.messageId === each.row))
      const row = spot && rows.find((each) => each.dataset.messageId === spot.row)
      if (!spot || !row) {
        if (element.hasAttribute("data-placing")) older()
        return
      }
      const delta = row.getBoundingClientRect().top - element.getBoundingClientRect().top - spot.offset
      if (Math.abs(delta) > 0.5) element.scrollBy({ top: delta, behavior: "instant" })
      reveal()
    }
    element.setAttribute("data-placing", "")
    hold()
    // ast-grep-ignore: no-manual-scroll -- keeps that place while the rows above it load and grow
    const observer = new ResizeObserver(hold)
    observer.observe(content)
    observer.observe(element)
    element.addEventListener("scroll", hold, { passive: true })
    const settle = () => {
      observer.disconnect()
      element.removeEventListener("scroll", hold)
      window.clearTimeout(timer)
      reveal()
      for (const type of placeInputs) window.removeEventListener(type, settle, { capture: true })
    }
    const timer = window.setTimeout(settle, givingUpMs)
    for (const type of placeInputs) window.addEventListener(type, settle, { capture: true, passive: true })
    return settle
  }, [viewport, place, session])
}

// oxlint-disable-next-line ren/no-comments -- Hands MessageScroller over to reading after a scroll it did not see coming, such as a Page Up from the composer or a link to a heading, so it stops holding a sent message at the top. MessageScroller takes that from a wheel event and has no other API for it.
export const read = (viewport: HTMLElement) => {
  viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 0 }))
}

// oxlint-disable-next-line ren/no-comments -- A sent message holds at the top of the view. MessageScroller anchors a new row only when it lands at the end of the list, and the working row can sit after it, so the transcript asks for the scroll once per sent message, a frame after MessageScroller has handled the new row.
export function useAnchorSent(sent: string | undefined, scrollTo: (messageId: string) => void) {
  const anchor = useEffectEvent(scrollTo)
  useEffect(() => {
    if (!sent) return
    const frame = requestAnimationFrame(() => anchor(sent))
    return () => cancelAnimationFrame(frame)
  }, [sent])
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
