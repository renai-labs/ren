import type { RefObject } from "react"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"

export function PageField(props: { label?: string; current: number; total: number; onGoto: (page: number) => void }) {
  const [field, setField] = useState<string>()
  const shown = field ?? String(props.current)
  return (
    <div className="flex items-center justify-end gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Previous ${(props.label ?? "Page").toLowerCase()}`}
        disabled={props.current <= 1}
        onClick={() => props.onGoto(props.current - 1)}
      >
        <IconChevronLeft />
      </Button>
      {props.label ?? "Page"}
      <Input
        aria-label={`${props.label ?? "Page"} number`}
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
        aria-label={`Next ${(props.label ?? "Page").toLowerCase()}`}
        disabled={props.current >= props.total}
        onClick={() => props.onGoto(props.current + 1)}
      >
        <IconChevronRight />
      </Button>
    </div>
  )
}

export function usePageKeys(props: {
  anchor: RefObject<HTMLElement | null>
  ready: boolean
  move: (delta: number) => void
}) {
  const step = useEffectEvent(props.move)
  useEffect(() => {
    // oxlint-disable-next-line ren/no-comments -- the dialog stops arrow keys from reaching the window, so the listener sits on the dialog
    const target = props.anchor.current?.closest('[role="dialog"]')
    if (!target) return
    const keys = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.target instanceof HTMLInputElement) return
      if (event.metaKey || event.ctrlKey) return
      if (event.key === "ArrowRight" || event.key === "PageDown") step(1)
      else if (event.key === "ArrowLeft" || event.key === "PageUp") step(-1)
      else return
      event.preventDefault()
    }
    target.addEventListener("keydown", keys)
    return () => target.removeEventListener("keydown", keys)
  }, [props.anchor, props.ready])
}

export function useNear(host: RefObject<HTMLElement | null>, onVisible: () => void) {
  const [near, setNear] = useState(false)
  const visible = useEffectEvent(onVisible)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const nearby = new IntersectionObserver((entries) => setNear(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: "1200px",
    })
    const reading = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) visible()
      },
      { rootMargin: "-45% 0px -45% 0px" },
    )
    nearby.observe(element)
    reading.observe(element)
    return () => {
      nearby.disconnect()
      reading.disconnect()
    }
  }, [host])
  return near
}

export function BitmapCanvas(props: {
  paint: (() => Promise<ImageBitmap | undefined>) | undefined
  version: string
  className: string
  size?: { readonly width: number; readonly height: number }
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const paint = useEffectEvent(() => props.paint?.())
  const enabled = props.paint !== undefined
  useEffect(() => {
    const target = canvas.current
    if (!enabled || !target) return
    const cancelled = { value: false }
    paint()?.then(
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
  }, [enabled, props.version])
  // oxlint-disable-next-line react/forbid-dom-props -- the canvas takes the size of its page or slide at the zoom level
  return <canvas ref={canvas} className={props.className} style={props.size} />
}
