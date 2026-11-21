import { Suspense, use, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"
import type { DiagramPlugin } from "@streamdown/mermaid"
import { IconMaximize, IconMinus, IconPlus } from "@tabler/icons-react"
import { cn } from "cn"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"

type Theme = "dark" | "default"

interface View {
  readonly x: number
  readonly y: number
  readonly scale: number
}

let plugin: Promise<DiagramPlugin> | undefined
const drawn = new Map<string, Promise<SVGSVGElement | undefined>>()
const kept = 32
const margin = 48
const step = 1.2
const nudge = 48

const draw = (chart: string, theme: Theme) => {
  const key = `${theme}\n${chart}`
  const cached = drawn.get(key)
  if (cached) return cached
  const next = (plugin ??= import("@streamdown/mermaid").then((module) => module.mermaid))
    .then((mermaid) =>
      mermaid
        .getMermaid({ theme, fontFamily: "var(--font-sans)" })
        .render(`mermaid-diagram-${drawn.size}-${Date.now()}`, chart),
    )
    .then(
      (result) => new DOMParser().parseFromString(result.svg, "text/html").querySelector("svg") ?? undefined,
      () => undefined,
    )
  drawn.set(key, next)
  const oldest = drawn.keys().next().value
  if (drawn.size > kept && oldest !== undefined) drawn.delete(oldest)
  return next
}

const subscribeTheme = (notify: () => void) => {
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}
const currentTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "default")

const clamp = (scale: number) => Math.min(4, Math.max(0.1, scale))

const keyMoves: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  ArrowLeft: { x: nudge, y: 0 },
  ArrowRight: { x: -nudge, y: 0 },
  ArrowUp: { x: 0, y: nudge },
  ArrowDown: { x: 0, y: -nudge },
}

function Drawing(props: { chart: string; theme: Theme; label: string }) {
  const svg = use(draw(props.chart, props.theme))
  const viewport = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const view = useRef<View>({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ readonly x: number; readonly y: number } | undefined>(undefined)
  if (!svg) return <p className="m-auto text-sm text-muted-foreground">Couldn’t draw this diagram.</p>
  const width = svg.viewBox.baseVal.width
  const height = svg.viewBox.baseVal.height
  const apply = (next: View) => {
    view.current = next
    if (content.current) content.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`
  }
  const fit = () => {
    const box = viewport.current
    if (!box) return
    const scale = clamp(Math.min(1, (box.clientWidth - margin) / width, (box.clientHeight - margin) / height))
    apply({ scale, x: (box.clientWidth - width * scale) / 2, y: (box.clientHeight - height * scale) / 2 })
  }
  const zoom = (factor: number, at?: { readonly x: number; readonly y: number }) => {
    const box = viewport.current
    if (!box) return
    const point = at ?? { x: box.clientWidth / 2, y: box.clientHeight / 2 }
    const current = view.current
    const scale = clamp(current.scale * factor)
    const ratio = scale / current.scale
    apply({ scale, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio })
  }
  const pan = (x: number, y: number) => apply({ ...view.current, x: view.current.x + x, y: view.current.y + y })
  const release = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = undefined
    delete event.currentTarget.dataset["dragging"]
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = keyMoves[event.key]
    if (move) pan(move.x, move.y)
    if (event.key === "+" || event.key === "=") zoom(step)
    if (event.key === "-") zoom(1 / step)
    if (event.key === "0") fit()
    if (move || ["+", "=", "-", "0"].includes(event.key)) event.preventDefault()
  }
  return (
    <div className="relative min-h-0 flex-1">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- an application canvas takes its own pointer and arrow keys to pan and zoom */}
      <div
        role="application"
        aria-roledescription="diagram"
        aria-label={`${props.label}. Drag or use the arrow keys to move, and plus or minus to zoom.`}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the canvas pans and zooms from the keyboard
        tabIndex={0}
        className="absolute inset-0 cursor-grab touch-none overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset data-dragging:cursor-grabbing"
        ref={(node) => {
          viewport.current = node
          if (!node) return
          fit()
          const onWheel = (event: WheelEvent) => {
            event.preventDefault()
            if (!event.ctrlKey && !event.metaKey) return pan(-event.deltaX, -event.deltaY)
            const rect = node.getBoundingClientRect()
            zoom(Math.exp(-event.deltaY * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top })
          }
          node.addEventListener("wheel", onWheel, { passive: false })
          return () => node.removeEventListener("wheel", onWheel)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          drag.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.dataset["dragging"] = ""
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start) return
          drag.current = { x: event.clientX, y: event.clientY }
          pan(event.clientX - start.x, event.clientY - start.y)
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={onKeyDown}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          ref={(node) => {
            content.current = node
            const shown = svg.cloneNode(true)
            if (!node || !(shown instanceof SVGSVGElement)) return
            shown.setAttribute("aria-hidden", "true")
            shown.setAttribute("width", String(width))
            shown.setAttribute("height", String(height))
            shown.style.maxWidth = "none"
            node.replaceChildren(shown)
          }}
        />
      </div>
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoom(1 / step)}>
          <IconMinus />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoom(step)}>
          <IconPlus />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Fit to view" onClick={fit}>
          <IconMaximize />
        </Button>
      </div>
    </div>
  )
}

export function MermaidDiagram(props: { chart: string; label: string; className?: string | undefined }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "default" as const)
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", props.className)}>
      <Suspense fallback={<Spinner className="m-auto" />}>
        <Drawing key={`${theme}\n${props.chart}`} chart={props.chart} theme={theme} label={props.label} />
      </Suspense>
    </div>
  )
}
