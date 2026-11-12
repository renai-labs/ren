import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Schema } from "effect"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { Platform } from "../../platform/platform.js"
import { PageField } from "./page-field.js"
import type { PreviewProps } from "./preview.js"
import { workerCalls } from "./worker-call.js"
import { BookmarkTarget, WordSpan } from "./office/word-protocol.js"

const Pages = Schema.Array(
  Schema.Struct({ width: Schema.Number, height: Schema.Number, background: Schema.UndefinedOr(Schema.String) }),
)
const decodePages = Schema.decodeUnknownSync(Pages)
const decodeSpans = Schema.decodeUnknownSync(Schema.Array(WordSpan))
const decodeTarget = Schema.decodeUnknownSync(BookmarkTarget)

type Hit = { page: number; span: number }

const lookAhead = "1200px"
const hitClass = "bg-yellow-300/70"
const activeClass = "bg-orange-400/80"

type Calls = ReturnType<typeof workerCalls>

function Page(props: {
  index: number
  size: { width: number; height: number; background: string | undefined }
  scale: number
  paint: (index: number, scale: number) => Promise<ImageBitmap | undefined>
  text: (index: number) => Promise<readonly WordSpan[]>
  spans: readonly WordSpan[] | undefined
  hits: readonly Hit[]
  active: number
  onVisible: (index: number) => void
  onLink: (link: NonNullable<WordSpan["link"]>) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const visible = useEffectEvent(props.onVisible)
  const paint = props.paint
  const loadText = props.text
  useEffect(() => {
    const element = host.current
    if (!element) return
    const nearby = new IntersectionObserver((entries) => setNear(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: lookAhead,
    })
    const reading = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) visible(props.index)
      },
      { rootMargin: "-45% 0px -45% 0px" },
    )
    nearby.observe(element)
    reading.observe(element)
    return () => {
      nearby.disconnect()
      reading.disconnect()
    }
  }, [props.index])
  useEffect(() => {
    const target = canvas.current
    if (!near || !target) return
    const cancelled = { value: false }
    paint(props.index, props.scale).then(
      (bitmap) => {
        if (!bitmap) return
        if (cancelled.value) return bitmap.close()
        target.width = bitmap.width
        target.height = bitmap.height
        target.getContext("2d")?.drawImage(bitmap, 0, 0)
        bitmap.close()
      },
      () => undefined,
    )
    return () => {
      cancelled.value = true
    }
  }, [near, props.index, props.scale, paint])
  useEffect(() => {
    if (near) void loadText(props.index)
  }, [near, props.index, loadText])
  const width = Math.floor(props.size.width * props.scale)
  const marks = props.hits.reduce((all, hit, index) => {
    if (hit.page === props.index) all.set(hit.span, [...(all.get(hit.span) ?? []), index])
    return all
  }, new Map<number, number[]>())
  return (
    <div
      ref={host}
      data-page={props.index + 1}
      className="relative mx-auto shrink-0 shadow-sm"
      // oxlint-disable-next-line react/forbid-dom-props -- the page size follows the document and the zoom level
      style={{
        width,
        height: Math.floor(props.size.height * props.scale),
        background: props.size.background ?? "white",
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <div className="absolute inset-0 overflow-hidden text-transparent">
        {(props.spans ?? []).map((span, index) => {
          const found = marks.get(index)
          const link = span.link
          return (
            // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- only a link span takes the link role and the handlers
            <span
              // oxlint-disable-next-line react/no-array-index-key -- a span has no identity but its position
              key={index}
              data-hit={found?.includes(props.active) ? "active" : undefined}
              dir={span.dir}
              title={span.title}
              role={link ? "link" : undefined}
              tabIndex={link ? 0 : undefined}
              onClick={link ? () => props.onLink(link) : undefined}
              onKeyDown={
                link
                  ? (event) => {
                      if (event.key === "Enter") props.onLink(link)
                    }
                  : undefined
              }
              className={cn(
                "absolute origin-left whitespace-pre",
                link && "cursor-pointer",
                found && (found.includes(props.active) ? activeClass : hitClass),
              )}
              // oxlint-disable-next-line react/forbid-dom-props -- each span sits where its words are painted
              style={{
                left: `${span.left * 100}%`,
                top: `${span.top * 100}%`,
                fontSize: span.size * width,
                lineHeight: 1.2,
                fontFamily: "sans-serif",
                transform: span.transform,
              }}
            >
              {span.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function DocxView(props: PreviewProps) {
  const platform = Platform.usePlatform()
  const [pages, setPages] = useState<typeof Pages.Type>()
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)
  const [texts, setTexts] = useState<Record<number, readonly WordSpan[]>>({})
  const [hits, setHits] = useState<readonly Hit[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const client = useRef<Calls>(undefined)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const asked = useRef(new Map<number, Promise<readonly WordSpan[]>>())
  const fail = useEffectEvent(props.onError)
  const count = useEffectEvent(props.onCount)
  useEffect(() => {
    const calls = workerCalls(() => new Worker(new URL("./office/docx.worker.ts", import.meta.url), { type: "module" }))
    client.current = calls
    const requests = asked.current
    calls
      .call({ type: "open", bytes: structuredClone(props.bytes) })
      .then((opened) => setPages(decodePages(opened)), fail)
    return () => {
      calls.close()
      requests.clear()
    }
  }, [props.bytes])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    // ast-grep-ignore: no-manual-scroll -- measures the page column to fit pages to its width, not a chat
    const observer = new ResizeObserver(() => setWidth(element.clientWidth - 48))
    observer.observe(element)
    return () => observer.disconnect()
  }, [pages])
  const widest = pages?.reduce((most, page) => Math.max(most, page.width), 1) ?? 1
  const scale = props.zoom === "fit" ? Math.max(0.1, width / widest) : props.zoom
  const enqueue = <T,>(job: () => Promise<T>) => {
    const run = queue.current.then(job)
    queue.current = run.catch(() => undefined)
    return run
  }
  const paint = (index: number, at: number) =>
    enqueue(async () => {
      const bitmap = await client.current?.call({ type: "paint", index, scale: at, ratio: devicePixelRatio })
      return bitmap instanceof ImageBitmap ? bitmap : undefined
    })
  const text = (index: number) => {
    const known = asked.current.get(index)
    if (known) return known
    const run = enqueue(async () => {
      const spans = decodeSpans(await client.current?.call({ type: "text", index }))
      setTexts((all) => ({ ...all, [index]: spans }))
      return spans
    })
    asked.current.set(index, run)
    return run
  }
  const needle = props.query.trim().toLowerCase()
  const load = useEffectEvent(text)
  useEffect(() => {
    if (!pages || !needle) {
      count(0)
      return
    }
    const cancelled = { value: false }
    Promise.all(pages.map((_, index) => load(index))).then(
      (all) => {
        if (cancelled.value) return
        const found = all.flatMap((spans, page) =>
          spans.flatMap((span, index) => {
            const lower = span.text.toLowerCase()
            const at = lower.split(needle).length - 1
            return Array.from({ length: at }, () => ({ page, span: index }))
          }),
        )
        setHits(found)
        count(found.length)
      },
      () => undefined,
    )
    return () => {
      cancelled.value = true
    }
  }, [pages, needle])
  const scrollToPage = (number: number, offset = 0) => {
    if (!pages) return 1
    const target = Math.min(Math.max(1, Math.round(number)), pages.length)
    const page = scroller.current?.querySelector(`[data-page="${target}"]`)
    if (page instanceof HTMLElement) scroller.current?.scrollTo({ top: page.offsetTop - 12 + offset })
    return target
  }
  const goto = (number: number, offset = 0) => setCurrent(scrollToPage(number, offset))
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
  const shown = needle ? hits : []
  const hit = shown[props.active]
  const jump = useEffectEvent(scrollToPage)
  useEffect(() => {
    if (!hit) return
    jump(hit.page + 1)
    const timer = setTimeout(
      () => scroller.current?.querySelector('[data-hit="active"]')?.scrollIntoView({ block: "center" }),
      150,
    )
    return () => clearTimeout(timer)
  }, [hit, props.active])
  const follow = async (link: NonNullable<WordSpan["link"]>) => {
    if (link.kind === "external") {
      platform.openExternal(link.url)
      return
    }
    const place = decodeTarget(await client.current?.call({ type: "bookmark", name: link.bookmark }))
    if (place) goto(place.index + 1, place.y * scale)
  }
  if (!pages) {
    return (
      <Loading className="m-6 flex-1">
        <div className="mx-auto aspect-[8.5/11] h-96" />
      </Loading>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain bg-muted/40 p-6"
      >
        {pages.map((size, index) => (
          <Page
            // oxlint-disable-next-line react/no-array-index-key -- a page has no identity but its position
            key={index}
            index={index}
            size={size}
            scale={scale}
            paint={paint}
            text={text}
            spans={texts[index]}
            hits={shown}
            active={props.active}
            onVisible={(visible) => setCurrent(visible + 1)}
            onLink={(link) => void follow(link)}
          />
        ))}
      </div>
      <PageField current={current} total={pages.length} onGoto={goto} />
    </div>
  )
}
