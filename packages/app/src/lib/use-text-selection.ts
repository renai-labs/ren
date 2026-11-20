import { useEffect, useEffectEvent, useState, type RefObject } from "react"
import { Composer } from "@ren/chat"

export interface TextSelection {
  readonly range: Range
  readonly text: string
  readonly source: string | undefined
}

const quotableOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest("[data-quotable]")

// oxlint-disable-next-line ren/no-comments -- A selection's text breaks lines between paragraphs and a range's text does not, so the two compare by their letters alone.
const letters = (text: string) => text.replaceAll(/\s+/gu, "")

const readTextSelection = (root: HTMLElement | null): TextSelection | undefined => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  const block = quotableOf(range.startContainer)
  if (!block || !root?.contains(block)) return
  const text = selection.toString().trim()
  if (!text) return
  const clipped = range.cloneRange()
  if (block !== quotableOf(range.endContainer)) clipped.setEnd(block, block.childNodes.length)
  if (letters(clipped.toString()) !== letters(text)) return
  return { range: clipped, text, source: block.getAttribute("data-quotable") ?? undefined }
}

const visible = (range: Range) => {
  const rect = range.getBoundingClientRect()
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.width + rect.height > 0
}

export function useTextSelection(options: {
  readonly root: RefObject<HTMLElement | null>
  readonly paused: boolean
  readonly onAlt: (selection: TextSelection) => void
}) {
  const [selected, setSelected] = useState<TextSelection | undefined>()
  const paused = options.paused
  const read = useEffectEvent(() => readTextSelection(options.root.current))
  const onAlt = useEffectEvent(options.onAlt)
  useEffect(() => {
    if (paused) return
    const pointer = { down: false }
    const update = () => setSelected(pointer.down ? undefined : read())
    const press = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element && event.target.closest("[data-slot=popover-content]"))
      )
        return
      pointer.down = true
      setSelected(undefined)
    }
    const release = (event: PointerEvent) => {
      if (!pointer.down) return
      pointer.down = false
      const next = read()
      if (!event.altKey || !next || next.text.length > Composer.quoteLimit) {
        setSelected(next)
        return
      }
      onAlt(next)
      window.getSelection()?.removeAllRanges()
      setSelected(undefined)
    }
    const scrolled = () => setSelected((current) => (current && visible(current.range) ? current : undefined))
    document.addEventListener("selectionchange", update)
    document.addEventListener("pointerdown", press)
    document.addEventListener("pointerup", release)
    window.addEventListener("scroll", scrolled, { capture: true, passive: true })
    return () => {
      document.removeEventListener("selectionchange", update)
      document.removeEventListener("pointerdown", press)
      document.removeEventListener("pointerup", release)
      window.removeEventListener("scroll", scrolled, { capture: true })
    }
  }, [paused])
  return { selected, clear: () => setSelected(undefined) }
}
