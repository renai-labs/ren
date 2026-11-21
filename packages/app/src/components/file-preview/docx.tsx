import { useEffect, useEffectEvent, useRef, useState } from "react"
import { renderAsync } from "docx-preview"
import { Loading } from "@ren/ui/loading"
import { Platform } from "../../platform/platform.js"
import { PageField, usePageKeys } from "./page-field.js"
import { maxFitWidth, type PreviewProps } from "./preview.js"

const hitName = "ren-file-hit"
const activeName = "ren-file-active"

const special = /[.*+?^${}()|[\]\\]/gu

const findRanges = (root: Element, needle: string) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Text; start: number }> = []
  const text = { value: "" }
  while (walker.nextNode())
    if (walker.currentNode instanceof Text && walker.currentNode.parentElement?.closest("style") === null) {
      nodes.push({ node: walker.currentNode, start: text.value.length })
      text.value += walker.currentNode.data
    }
  const at = (offset: number) => {
    const found = nodes.findLast((entry) => entry.start <= offset)
    return found && { node: found.node, offset: Math.min(offset - found.start, found.node.length) }
  }
  return [...text.value.matchAll(new RegExp(needle.replaceAll(special, "\\$&"), "giu"))].flatMap((found) => {
    const start = at(found.index)
    const end = at(found.index + found[0].length)
    if (!start || !end) return []
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return [range]
  })
}

const makeSafe = (root: Element) => {
  for (const link of root.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") ?? ""
    if (!href.startsWith("#") && URL.parse(href)?.protocol !== "https:") link.removeAttribute("href")
  }
  for (const image of root.querySelectorAll("img"))
    if (!/^(?:blob|data):/u.test(image.getAttribute("src") ?? "")) image.removeAttribute("src")
}

export function DocxView(props: PreviewProps) {
  const platform = Platform.usePlatform()
  const scroller = useRef<HTMLDivElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState<{ count: number; width: number }>()
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)
  const [hits, setHits] = useState<ReadonlyArray<Range>>([])
  const fail = useEffectEvent(props.onError)
  const count = useEffectEvent(props.onCount)
  const openExternal = useEffectEvent(platform.openExternal)
  useEffect(() => {
    const host = pages.current
    const root = scroller.current
    if (!host || !root) return
    const page = document.createElement("div")
    page.className = "contents"
    host.append(page)
    const reading = new IntersectionObserver(
      (entries) => {
        const seen = entries.find((entry) => entry.isIntersecting)?.target
        if (seen) setCurrent([...page.children].filter((child) => child.tagName === "SECTION").indexOf(seen) + 1)
      },
      { root, rootMargin: "-45% 0px -45% 0px" },
    )
    const follow = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      const href = link?.getAttribute("href")
      if (!href) return
      event.preventDefault()
      if (href.startsWith("#")) page.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView()
      else openExternal(href)
    }
    page.addEventListener("click", follow)
    renderAsync(props.bytes, page, undefined, { inWrapper: false, renderComments: false }).then(
      () => {
        if (!page.isConnected) return
        makeSafe(page)
        const sections = [...page.querySelectorAll(":scope > section")]
        for (const section of sections) reading.observe(section)
        const first = sections.at(0)
        if (first instanceof HTMLElement) setRendered({ count: sections.length, width: first.offsetWidth })
        else fail()
      },
      () => {
        if (page.isConnected) fail()
      },
    )
    return () => {
      reading.disconnect()
      page.remove()
    }
  }, [props.bytes])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    // ast-grep-ignore: no-manual-scroll -- measures the page column to fit pages to its width, not a chat
    const observer = new ResizeObserver(() => setWidth(element.clientWidth - 48))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const needle = props.query.trim()
  useEffect(() => {
    const found = rendered && needle && pages.current ? findRanges(pages.current, needle) : []
    setHits(found)
    count(found.length)
  }, [rendered, needle])
  useEffect(() => {
    const active = hits[props.active]
    CSS.highlights.set(hitName, new Highlight(...hits.filter((range) => range !== active)))
    CSS.highlights.set(activeName, new Highlight(...(active ? [active] : [])))
    active?.startContainer.parentElement?.scrollIntoView({ block: "center" })
    return () => {
      CSS.highlights.delete(hitName)
      CSS.highlights.delete(activeName)
    }
  }, [hits, props.active])
  const goto = (number: number) => {
    if (!rendered) return
    const target = Math.min(Math.max(1, Math.round(number)), rendered.count)
    const sections = pages.current?.querySelectorAll(":scope > div > section") ?? []
    sections[target - 1]?.scrollIntoView({ block: "start" })
    setCurrent(target)
  }
  usePageKeys({ anchor: scroller, ready: Boolean(rendered), move: (delta) => goto(current + delta) })
  const fit = rendered && width > 0 ? Math.max(0.1, Math.min(width, maxFitWidth) / rendered.width) : 1
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/40 p-6">
        {rendered ? null : (
          <Loading className="absolute inset-6">
            <div className="mx-auto aspect-[8.5/11] h-96" />
          </Loading>
        )}
        <div
          ref={pages}
          className="mx-auto flex w-max flex-col gap-3 [&_section]:bg-white [&_section]:shadow-sm"
          // oxlint-disable-next-line react/forbid-dom-props -- the zoom level is a number the user picks
          style={{
            zoom: rendered && props.zoom !== "fit" ? props.zoom : fit,
            visibility: rendered ? "visible" : "hidden",
          }}
        />
      </div>
      {rendered ? <PageField current={current} total={rendered.count} onGoto={goto} /> : null}
    </div>
  )
}
