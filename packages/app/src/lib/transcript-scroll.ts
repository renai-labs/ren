export * as TranscriptScroll from "./transcript-scroll.js"

import { startTransition, useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject } from "react"

export interface Spot {
  readonly row: string
  readonly offset: number
}

const places = new Map<string, ReadonlyArray<Spot> | undefined>()

const bottomSlack = 8

const atBottom = (viewport: HTMLElement) =>
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

const rooms = new Map<string, number>()

const roomOf = (element: HTMLElement) =>
  element.querySelector<HTMLElement>("[data-message-scroller-spacer]")?.offsetHeight ?? 0

// oxlint-disable-next-line ren/no-comments -- A sent message held at the top has room below it for the reply, and MessageScroller drops that room when the chat closes. A reopened chat gets the same room back as padding, which the rows below the last sent message then grow into as before, so the message is where it was left; rows loading above it take none.
export function useKeptRoom(viewport: RefObject<HTMLDivElement | null>, session: string) {
  useLayoutEffect(() => {
    const element = viewport.current
    const content = element?.querySelector<HTMLElement>("[data-slot=message-scroller-content]")
    if (!element || !content) return
    const room = rooms.get(session) ?? 0
    const kept = { room, rows: 0, left: room }
    rooms.delete(session)
    const apply = () => {
      if (kept.room > 0) content.style.setProperty("padding-bottom", `calc(1.5rem + ${kept.room}px)`)
      else content.style.removeProperty("padding-bottom")
    }
    const rowsOf = () => {
      const last = [...content.querySelectorAll<HTMLElement>("[data-row-key^='user']")].at(-1)
      const bottom = content.getBoundingClientRect().bottom - kept.room - roomOf(element)
      return last ? bottom - last.getBoundingClientRect().top : 0
    }
    apply()
    kept.rows = rowsOf()
    // ast-grep-ignore: no-manual-scroll -- shrinks the kept room as the reply grows into it, and scrolls nothing
    const observer = new ResizeObserver(() => {
      if (kept.room > 0) {
        const rows = rowsOf()
        kept.room = roomOf(element) > 0 ? 0 : Math.max(0, kept.room - (rows - kept.rows))
        kept.rows = rows
        apply()
      }
      kept.left = Math.max(roomOf(element), kept.room)
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      rooms.set(session, kept.left)
      content.style.removeProperty("padding-bottom")
    }
  }, [viewport, session])
}

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

// oxlint-disable-next-line ren/no-comments -- At the end: the bottom of the transcript's rows, not the room below them, is within a third of a screen of the view's bottom.
const nearEnd = (viewport: HTMLElement) => {
  const room = viewport.querySelector<HTMLElement>("[data-message-scroller-spacer]")?.offsetHeight ?? 0
  return viewport.scrollHeight - room - viewport.scrollTop - viewport.clientHeight <= viewport.clientHeight / 3
}

// oxlint-disable-next-line ren/no-comments -- Whether the person is at the end of the transcript, kept as they scroll and as it grows, so a message they send can tell where they were just before it arrived.
export function useAtEnd(viewport: RefObject<HTMLDivElement | null>) {
  const [atEnd, setAtEnd] = useState(true)
  useLayoutEffect(() => {
    const element = viewport.current
    const content = element?.querySelector("[data-slot=message-scroller-content]")
    if (!element || !content) return
    const check = () => setAtEnd(nearEnd(element))
    check()
    // ast-grep-ignore: no-manual-scroll -- measures where the person is as the transcript grows, and scrolls nothing
    const observer = new ResizeObserver(check)
    observer.observe(content)
    observer.observe(element)
    element.addEventListener("scroll", check, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener("scroll", check)
    }
  }, [viewport])
  return atEnd
}
