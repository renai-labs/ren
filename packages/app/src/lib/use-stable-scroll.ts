import { useEffect, useRef, type RefObject } from "react"

const atEnd = 8

const kept = 3

const settle = 2000

const scrollKeys = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "])

interface Anchor {
  readonly element: Element
  readonly top: number
}

interface Keeper {
  readonly pin: () => void
}

// oxlint-disable-next-line ren/no-comments -- Keeps the transcript where the person left it while anything around it loads or changes size: older messages, compaction, notices, images and messages that render as they scroll into view. It follows the end only while Ren streams and the person is at the end. A chat that just opened, or a message just sent, holds the end until the person scrolls or nothing has changed for 2 s. The browser's own scroll anchoring stays on and handles most shifts without stopping a smooth scroll; this corrects what it leaves: the top of the scroller, and Safari, which has none.
export function useStableScroll(options: {
  readonly viewport: RefObject<HTMLElement | null>
  readonly content: RefObject<HTMLElement | null>
  readonly streaming: boolean
  readonly sent: string | undefined
}) {
  const streaming = useRef(options.streaming)
  const keeper = useRef<Keeper | undefined>(undefined)
  const sent = useRef(options.sent)
  const { viewport: viewportRef, content: contentRef } = options

  useEffect(() => {
    streaming.current = options.streaming
  }, [options.streaming])

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    let anchors: ReadonlyArray<Anchor> = []
    let seen = viewport.scrollTop
    let bottom = true
    let pinned = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const unpin = () => {
      pinned = false
      clearTimeout(timer)
    }

    const items = () => content.querySelectorAll(":scope > [data-message-id]")

    const remember = () => {
      const top = viewport.getBoundingClientRect().top
      seen = viewport.scrollTop
      bottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= atEnd
      const visible: Anchor[] = []
      for (const element of items()) {
        const rect = element.getBoundingClientRect()
        if (rect.bottom > top + 1) visible.push({ element, top: rect.top - top })
        if (visible.length === kept) break
      }
      anchors = visible
    }

    const scrollBy = (delta: number) => {
      // ast-grep-ignore: no-manual-scroll -- MessageScroller's own following and turn anchoring moved the transcript while things loaded; this keeps it still instead
      viewport.scrollTop += delta
    }

    const toEnd = () => {
      scrollBy(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
      remember()
    }

    const pin = () => {
      pinned = true
      clearTimeout(timer)
      timer = setTimeout(unpin, settle)
      toEnd()
    }

    const keep = () => {
      if (pinned) return pin()
      if (streaming.current && bottom) return toEnd()
      // oxlint-disable-next-line ren/no-comments -- The person, the browser's anchoring or the scroller moved it since the last look, and the scroll event is still to come: take the view as it is.
      if (Math.abs(viewport.scrollTop - seen) > 0.5) return remember()
      const anchor = anchors.find((candidate) => candidate.element.isConnected)
      if (anchor) {
        const delta = anchor.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top
        if (Math.abs(delta) > 0.5) scrollBy(delta)
      }
      remember()
    }

    // ast-grep-ignore: no-manual-scroll -- a size change anywhere in the transcript is when its position has to be kept
    const sizes = new ResizeObserver(keep)
    sizes.observe(content)
    for (const element of items()) sizes.observe(element)
    const children = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) sizes.observe(node)
        for (const node of record.removedNodes) if (node instanceof Element) sizes.unobserve(node)
      }
      keep()
    })
    children.observe(content, { childList: true })

    const key = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) unpin()
    }
    viewport.addEventListener("scroll", remember, { passive: true })
    viewport.addEventListener("wheel", unpin, { passive: true })
    viewport.addEventListener("touchmove", unpin, { passive: true })
    viewport.addEventListener("pointerdown", unpin, { passive: true })
    viewport.addEventListener("keydown", key, { passive: true })
    keeper.current = { pin }
    pin()
    return () => {
      keeper.current = undefined
      unpin()
      sizes.disconnect()
      children.disconnect()
      viewport.removeEventListener("scroll", remember)
      viewport.removeEventListener("wheel", unpin)
      viewport.removeEventListener("touchmove", unpin)
      viewport.removeEventListener("pointerdown", unpin)
      viewport.removeEventListener("keydown", key)
    }
  }, [viewportRef, contentRef])

  // oxlint-disable-next-line ren/no-comments -- A message the person sends from here shows at the end, and Ren's answer follows it.
  useEffect(() => {
    if (!options.sent || options.sent === sent.current) return
    sent.current = options.sent
    keeper.current?.pin()
  }, [options.sent])
}
