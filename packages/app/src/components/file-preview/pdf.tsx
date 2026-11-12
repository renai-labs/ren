import { useEffect, useEffectEvent, useRef, useState } from "react"
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
// oxlint-disable-next-line no-restricted-imports -- types only; the module itself loads with import() below
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import type { PreviewProps } from "./preview.js"
import { workerTimeoutMs } from "./worker-call.js"
import "pdfjs-dist/web/pdf_viewer.css"

// oxlint-disable-next-line no-restricted-imports -- type only
type Pdfjs = typeof import("pdfjs-dist")
type Hit = { page: number; item: number }
type Size = { width: number; height: number }

const lookAhead = "1200px"
const thumbnailWidth = 96
const hitClass = "bg-yellow-300/70"
const activeClass = "bg-orange-400/80"

const pageOf = async (doc: PDFDocumentProxy, number: number) => doc.getPage(number)

const loadPdfjs = async () => {
  // oxlint-disable-next-line no-restricted-imports -- this module is itself a lazy chunk, and the import runs when a PDF opens
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href
  return pdfjs
}

function Thumbnail(props: { doc: PDFDocumentProxy; number: number; active: boolean; onPick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const task: { current: RenderTask | undefined } = { current: undefined }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || task.current) return
      pageOf(props.doc, props.number).then(
        (page) => {
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (thumbnailWidth * devicePixelRatio) / base.width })
          target.width = viewport.width
          target.height = viewport.height
          task.current = page.render({ canvas: target, viewport })
          task.current.promise.catch(() => undefined)
        },
        () => undefined,
      )
    })
    observer.observe(target)
    return () => {
      observer.disconnect()
      task.current?.cancel()
    }
  }, [props.doc, props.number])
  return (
    <Button
      variant="ghost"
      aria-label={`Page ${props.number}`}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onPick}
      className={cn(
        "h-auto flex-col gap-1 p-1.5 text-xs text-muted-foreground",
        props.active && "bg-muted text-foreground",
      )}
    >
      <canvas ref={canvas} className="w-24 bg-white shadow-sm" />
      {props.number}
    </Button>
  )
}

function Page(props: {
  doc: PDFDocumentProxy
  pdfjs: Pdfjs
  number: number
  scale: number
  size: Size
  hits: readonly Hit[]
  active: number
  onVisible: (number: number) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const layer = useRef<TextLayer>(undefined)
  const [near, setNear] = useState(false)
  const [rendered, setRendered] = useState(0)
  const [own, setOwn] = useState<Size>()
  const visible = useEffectEvent(props.onVisible)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const nearby = new IntersectionObserver((entries) => setNear(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: lookAhead,
    })
    const reading = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) visible(props.number)
      },
      { rootMargin: "-45% 0px -45% 0px" },
    )
    nearby.observe(element)
    reading.observe(element)
    return () => {
      nearby.disconnect()
      reading.disconnect()
    }
  }, [props.number])
  useEffect(() => {
    const target = canvas.current
    const container = text.current
    if (!near || !target || !container) return
    const task: { current: RenderTask | undefined } = { current: undefined }
    const cancelled = { value: false }
    const stale = () => cancelled.value
    pageOf(props.doc, props.number).then(
      async (page) => {
        if (stale()) return
        const base = page.getViewport({ scale: 1 })
        setOwn({ width: base.width, height: base.height })
        const viewport = page.getViewport({ scale: props.scale })
        container.style.setProperty("--total-scale-factor", String(props.scale))
        target.width = Math.floor(viewport.width * devicePixelRatio)
        target.height = Math.floor(viewport.height * devicePixelRatio)
        const painting = page.render({
          canvas: target,
          viewport,
          transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        })
        task.current = painting
        await painting.promise.catch(() => undefined)
        if (stale()) return
        container.replaceChildren()
        const reading = new props.pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport })
        layer.current = reading
        await reading.render().catch(() => undefined)
        if (!stale()) setRendered((count) => count + 1)
      },
      () => undefined,
    )
    return () => {
      cancelled.value = true
      task.current?.cancel()
      layer.current?.cancel()
      layer.current = undefined
      target.width = 0
      target.height = 0
      container.replaceChildren()
    }
  }, [near, props.doc, props.pdfjs, props.number, props.scale])
  useEffect(() => {
    const spans = layer.current?.textDivs ?? []
    for (const span of spans) span.classList.remove(hitClass, activeClass)
    for (const [index, hit] of props.hits.entries()) {
      if (hit.page !== props.number) continue
      const span = spans[hit.item]
      span?.classList.add(index === props.active ? activeClass : hitClass)
      if (index === props.active) span?.scrollIntoView({ block: "center" })
    }
  }, [props.hits, props.active, props.number, rendered])
  return (
    <div
      ref={host}
      data-page={props.number}
      className="relative mx-auto shrink-0 bg-white shadow-sm"
      // oxlint-disable-next-line react/forbid-dom-props -- the page size follows the document and the zoom level
      style={{
        width: Math.floor((own?.width ?? props.size.width / props.scale) * props.scale),
        height: Math.floor((own?.height ?? props.size.height / props.scale) * props.scale),
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {/* oxlint-disable-next-line better-tailwindcss/no-unknown-classes -- pdf.js's stylesheet styles the text layer by this name */}
      <div ref={text} className="textLayer absolute inset-0 text-transparent" />
    </div>
  )
}

const findHits = async (doc: PDFDocumentProxy, needle: string, cancelled: { value: boolean }) => {
  const found: Hit[] = []
  for (let number = 1; number <= doc.numPages && !cancelled.value; number++) {
    // oxlint-disable-next-line no-await-in-loop -- read one page at a time so a long document does not parse all at once
    const content = await (await doc.getPage(number)).getTextContent()
    const strings = content.items.flatMap((item) => ("str" in item ? [item.str.toLowerCase()] : []))
    for (const [item, str] of strings.entries())
      for (let at = str.indexOf(needle); at !== -1; at = str.indexOf(needle, at + needle.length))
        found.push({ page: number, item })
  }
  return found
}

function PageField(props: { current: number; total: number; onGoto: (page: number) => void }) {
  const [field, setField] = useState<string>()
  const shown = field ?? String(props.current)
  return (
    <div className="flex items-center justify-end gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous page"
        disabled={props.current <= 1}
        onClick={() => props.onGoto(props.current - 1)}
      >
        <IconChevronLeft />
      </Button>
      Page
      <Input
        aria-label="Page number"
        inputMode="numeric"
        className="h-7 w-12 text-center"
        value={shown}
        onChange={(event) => setField(event.target.value)}
        onBlur={() => setField(undefined)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !Number.isFinite(Number(shown))) return
          props.onGoto(Number(shown))
          setField(undefined)
        }}
      />
      of {props.total}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next page"
        disabled={props.current >= props.total}
        onClick={() => props.onGoto(props.current + 1)}
      >
        <IconChevronRight />
      </Button>
    </div>
  )
}

export function PdfView(props: PreviewProps) {
  const [opened, setOpened] = useState<{ doc: PDFDocumentProxy; pdfjs: Pdfjs; first: Size }>()
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)
  const [hits, setHits] = useState<readonly Hit[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const fail = useEffectEvent(props.onError)
  const count = useEffectEvent(props.onCount)
  useEffect(() => {
    const cancelled = { value: false }
    const destroy: { current: (() => void) | undefined } = { current: undefined }
    loadPdfjs()
      .then(async (pdfjs) => {
        const task = pdfjs.getDocument({ data: new Uint8Array(structuredClone(props.bytes)) })
        const timer = setTimeout(() => void task.destroy(), workerTimeoutMs)
        destroy.current = () => {
          clearTimeout(timer)
          void task.destroy()
        }
        const doc = await task.promise.finally(() => clearTimeout(timer))
        const first = (await doc.getPage(1)).getViewport({ scale: 1 })
        if (!cancelled.value) setOpened({ doc, pdfjs, first: { width: first.width, height: first.height } })
      })
      .catch(() => {
        if (!cancelled.value) fail()
      })
    return () => {
      cancelled.value = true
      destroy.current?.()
    }
  }, [props.bytes])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    // ast-grep-ignore: no-manual-scroll -- measures the page column to fit pages to its width, not a chat
    const observer = new ResizeObserver(() => setWidth(element.clientWidth - 48))
    observer.observe(element)
    return () => observer.disconnect()
  }, [opened])
  const doc = opened?.doc
  const needle = props.query.trim().toLowerCase()
  useEffect(() => {
    if (!doc || !needle) return
    const cancelled = { value: false }
    findHits(doc, needle, cancelled).then(
      (found) => {
        if (cancelled.value) return
        setHits(found)
        count(found.length)
      },
      () => undefined,
    )
    return () => {
      cancelled.value = true
    }
  }, [doc, needle])
  const shownHits = needle ? hits : []
  useEffect(() => {
    if (!needle) count(0)
  }, [needle])
  const goto = (number: number) => {
    if (!doc) return
    const target = Math.min(Math.max(1, Math.round(number)), doc.numPages)
    scroller.current?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: "start" })
    setCurrent(target)
  }
  const move = useEffectEvent((delta: number) => goto(current + delta))
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return
      if (event.key === "ArrowRight" || event.key === "PageDown") move(1)
      else if (event.key === "ArrowLeft" || event.key === "PageUp") move(-1)
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", keys)
    return () => window.removeEventListener("keydown", keys)
  }, [])
  const hit = shownHits[props.active]
  useEffect(() => {
    if (hit) scroller.current?.querySelector(`[data-page="${hit.page}"]`)?.scrollIntoView({ block: "center" })
  }, [hit])
  if (!opened) {
    return (
      <Loading className="m-6 flex-1">
        <div className="mx-auto aspect-[8.5/11] h-96" />
      </Loading>
    )
  }
  const scale = props.zoom === "fit" ? Math.max(0.1, width / opened.first.width) : props.zoom
  const size = { width: Math.floor(opened.first.width * scale), height: Math.floor(opened.first.height * scale) }
  const numbers = Array.from({ length: opened.doc.numPages }, (_, index) => index + 1)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-28 shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain border-r p-1 sm:flex">
          {numbers.map((number) => (
            <Thumbnail
              key={number}
              doc={opened.doc}
              number={number}
              active={current === number}
              onPick={() => goto(number)}
            />
          ))}
        </div>
        <div
          ref={scroller}
          className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain bg-muted/40 p-6"
        >
          {numbers.map((number) => (
            <Page
              key={number}
              doc={opened.doc}
              pdfjs={opened.pdfjs}
              number={number}
              scale={scale}
              size={size}
              hits={shownHits}
              active={props.active}
              onVisible={setCurrent}
            />
          ))}
        </div>
      </div>
      <PageField current={current} total={opened.doc.numPages} onGoto={goto} />
    </div>
  )
}
