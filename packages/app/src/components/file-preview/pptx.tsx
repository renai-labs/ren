import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Schema } from "effect"
import { Button } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { PageField } from "./page-field.js"
import type { PreviewProps } from "./preview.js"
import { workerCalls } from "./worker-call.js"

const Slides = Schema.Array(
  Schema.Struct({
    width: Schema.Number,
    height: Schema.Number,
    hidden: Schema.Boolean,
    notes: Schema.UndefinedOr(Schema.String),
    text: Schema.String,
  }),
)
const decodeSlides = Schema.decodeUnknownSync(Slides)

const thumbnailWidth = 112

type Paint = (index: number, density: number) => Promise<ImageBitmap | undefined>

function SlideCanvas(props: { index: number; width: number; height: number; density: number; paint: Paint }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const paint = useEffectEvent(props.paint)
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const cancelled = { value: false }
    paint(props.index, props.density).then(
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
  }, [props.index, props.density])
  return (
    <canvas
      ref={canvas}
      className="bg-white shadow-sm"
      // oxlint-disable-next-line react/forbid-dom-props -- the slide's size follows the deck and the zoom level
      style={{ width: props.width, height: props.height }}
    />
  )
}

function Thumbnail(props: {
  index: number
  size: { width: number; height: number }
  hidden: boolean
  active: boolean
  paint: Paint
  onPick: () => void
}) {
  const host = useRef<HTMLButtonElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => setNear(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: "600px",
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scale = thumbnailWidth / props.size.width
  return (
    <Button
      ref={host}
      variant="ghost"
      aria-label={`Slide ${props.index + 1}`}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onPick}
      className={cn(
        "h-auto flex-col gap-1 p-1.5 text-xs text-muted-foreground",
        props.active && "bg-muted text-foreground",
        props.hidden && "opacity-50",
      )}
    >
      {near ? (
        <SlideCanvas
          index={props.index}
          width={thumbnailWidth}
          height={Math.floor(props.size.height * scale)}
          density={scale * devicePixelRatio}
          paint={props.paint}
        />
      ) : (
        <div
          className="bg-white shadow-sm"
          // oxlint-disable-next-line react/forbid-dom-props -- the slide's size follows the deck
          style={{ width: thumbnailWidth, height: Math.floor(props.size.height * scale) }}
        />
      )}
      {props.index + 1}
    </Button>
  )
}

export function PptxView(props: PreviewProps) {
  const [slides, setSlides] = useState<typeof Slides.Type>()
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [current, setCurrent] = useState(0)
  const stage = useRef<HTMLDivElement>(null)
  const client = useRef<ReturnType<typeof workerCalls>>(undefined)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const fail = useEffectEvent(props.onError)
  const count = useEffectEvent(props.onCount)
  useEffect(() => {
    const calls = workerCalls(() => new Worker(new URL("./office/pptx.worker.ts", import.meta.url), { type: "module" }))
    client.current = calls
    calls
      .call({ type: "open", bytes: structuredClone(props.bytes) })
      .then((opened) => setSlides(decodeSlides(opened)), fail)
    return () => calls.close()
  }, [props.bytes])
  useEffect(() => {
    const element = stage.current
    if (!element) return
    // ast-grep-ignore: no-manual-scroll -- measures the stage to fit the slide, not a chat
    const observer = new ResizeObserver(() =>
      setBox({ width: element.clientWidth - 48, height: element.clientHeight - 48 }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [slides])
  const paint: Paint = (index, density) => {
    const run = queue.current.then(async () => {
      const bitmap = await client.current?.call({ type: "paint", index, density })
      return bitmap instanceof ImageBitmap ? bitmap : undefined
    })
    queue.current = run.catch(() => undefined)
    return run
  }
  const needle = props.query.trim().toLowerCase()
  const hits = needle
    ? (slides ?? []).flatMap((slide, index) =>
        Array.from({ length: slide.text.toLowerCase().split(needle).length - 1 }, () => index),
      )
    : []
  const total = hits.length
  const hitKey = hits.join(",")
  useEffect(() => count(total), [hitKey, total])
  const hit = hits[props.active]
  const spot = `${props.active}:${hit}`
  const [seenHit, setSeenHit] = useState(spot)
  if (spot !== seenHit) {
    setSeenHit(spot)
    if (hit !== undefined) setCurrent(hit)
  }
  const goto = (number: number) => {
    if (slides) setCurrent(Math.min(Math.max(0, Math.round(number) - 1), slides.length - 1))
  }
  const move = useEffectEvent((delta: number) => goto(current + 1 + delta))
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
  const slide = slides?.[current]
  if (!slides || !slide) {
    return (
      <Loading className="m-6 flex-1">
        <div className="mx-auto aspect-video h-96" />
      </Loading>
    )
  }
  const fit = Math.max(0.05, Math.min(box.width / slide.width, box.height / slide.height))
  const scale = props.zoom === "fit" ? fit : fit * props.zoom
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-32 shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain border-r p-1 sm:flex">
          {slides.map((item, index) => (
            <Thumbnail
              // oxlint-disable-next-line react/no-array-index-key -- a slide has no identity but its position
              key={index}
              index={index}
              size={item}
              hidden={item.hidden}
              active={index === current}
              paint={paint}
              onPick={() => setCurrent(index)}
            />
          ))}
        </div>
        <div ref={stage} className="flex min-w-0 flex-1 overflow-auto overscroll-contain bg-muted/40 p-6">
          <div className="m-auto">
            <SlideCanvas
              index={current}
              width={Math.floor(slide.width * scale)}
              height={Math.floor(slide.height * scale)}
              density={scale * devicePixelRatio}
              paint={paint}
            />
          </div>
        </div>
      </div>
      <PageField label="Slide" current={current + 1} total={slides.length} onGoto={goto} />
    </div>
  )
}
