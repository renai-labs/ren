import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { IconMaximize, IconMinus, IconPlus } from "@tabler/icons-react"
import { cn } from "cn"
import { Button } from "@ren/ui/button"

interface View {
  readonly x: number
  readonly y: number
  readonly scale: number
}

const margin = 48
const step = 1.2
const nudge = 48

const clamp = (scale: number) => Math.min(4, Math.max(0.1, scale))

const keyMoves: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  ArrowLeft: { x: nudge, y: 0 },
  ArrowRight: { x: -nudge, y: 0 },
  ArrowUp: { x: 0, y: nudge },
  ArrowDown: { x: 0, y: -nudge },
}

export function PanZoom(props: {
  width: number
  height: number
  label: string
  className?: string | undefined
  children: ReactNode
}) {
  const viewport = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const view = useRef<View>({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ readonly x: number; readonly y: number } | undefined>(undefined)
  const apply = (next: View) => {
    view.current = next
    if (content.current) content.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`
  }
  const fit = () => {
    const box = viewport.current
    if (!box) return
    const scale = clamp(
      Math.min(1, (box.clientWidth - margin) / props.width, (box.clientHeight - margin) / props.height),
    )
    apply({ scale, x: (box.clientWidth - props.width * scale) / 2, y: (box.clientHeight - props.height * scale) / 2 })
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
    <div className={cn("relative min-h-0 flex-1", props.className)}>
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
          ref={content}
          className="absolute top-0 left-0 origin-top-left"
          // oxlint-disable-next-line react/forbid-dom-props -- the canvas is as large as the drawing it holds
          style={{ width: props.width, height: props.height }}
        >
          {props.children}
        </div>
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
