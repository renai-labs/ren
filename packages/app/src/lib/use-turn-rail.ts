import { useEffect, useRef, useState } from "react"

export const turnSelector = (id: string) => `[data-turn="${CSS.escape(id)}"]`

const endSlack = 8

// oxlint-disable-next-line ren/no-comments -- The turn being read: the last whose message sits above a line a third down the chat, or at the chat's end the last one in view. It follows the scroll of whichever chat shows, rows that render late included.
const readingOf = (root: HTMLElement, ids: ReadonlyArray<string>) => {
  const viewport = root.querySelector<HTMLElement>("[data-slot=message-scroller-viewport]")
  if (!viewport) return { current: undefined, seen: new Set<string>() }
  const box = viewport.getBoundingClientRect()
  const atEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= endSlack
  const line = atEnd ? box.bottom : box.top + viewport.clientHeight / 3
  const placed = ids.flatMap((id) => {
    const element = viewport.querySelector(turnSelector(id))
    return element ? [{ id, box: element.getBoundingClientRect() }] : []
  })
  const seen = new Set(
    placed.filter((turn) => turn.box.bottom > box.top && turn.box.top < box.bottom).map((turn) => turn.id),
  )
  const current = placed.findLast((turn) => turn.box.top <= line)?.id ?? placed[0]?.id
  return { current, seen }
}

export function useTurnRail(ids: ReadonlyArray<string>) {
  const ref = useRef<HTMLElement>(null)
  const [reading, setReading] = useState<{ readonly current?: string | undefined; readonly seen: ReadonlySet<string> }>(
    () => ({ seen: new Set() }),
  )
  const key = ids.join(",")
  const scope = () => ref.current?.parentElement
  const ticks = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-turn-tick]") ?? [])]
  useEffect(() => {
    const root = ref.current?.parentElement
    if (!root) return
    const list = key.split(",").filter(Boolean)
    const frame = { id: 0 }
    const update = () => {
      cancelAnimationFrame(frame.id)
      frame.id = requestAnimationFrame(() => {
        const next = readingOf(root, list)
        setReading((previous) =>
          previous.current === next.current &&
          previous.seen.size === next.seen.size &&
          [...next.seen].every((id) => previous.seen.has(id))
            ? previous
            : next,
        )
      })
    }
    update()
    root.addEventListener("scroll", update, { capture: true, passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(root)
    const content = new MutationObserver(update)
    content.observe(root, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame.id)
      root.removeEventListener("scroll", update, { capture: true })
      observer.disconnect()
      content.disconnect()
    }
  }, [key])
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.code !== "KeyJ") return
      event.preventDefault()
      ref.current?.querySelector<HTMLElement>("[data-turn-tick][tabindex='0']")?.focus()
    }
    window.addEventListener("keydown", focus)
    return () => window.removeEventListener("keydown", focus)
  }, [])
  return [
    ref,
    { inView: reading.seen, current: reading.current, scope, focus: (index: number) => ticks()[index]?.focus() },
  ] as const
}
