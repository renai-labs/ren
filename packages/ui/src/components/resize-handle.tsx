import { useRef } from "react"
import { cn } from "cn"

const step = 16

// oxlint-disable-next-line ren/no-comments -- Resizes the element whose `side` edge it sits on: dragging or pressing an arrow away from the element widens it. `onResize` follows the pointer without a render, `onCommit` keeps the width, and a double click resets it.
function ResizeHandle(props: {
  label: string
  side: "left" | "right"
  width: number | undefined
  min: number
  max: () => number
  onResize: (width: number) => void
  onCommit: (width: number) => void
  onReset: () => void
  className?: string
}) {
  const drag = useRef<{ readonly x: number; readonly width: number; readonly max: number; current: number }>(null)
  const clamp = (width: number, max: number) =>
    Math.round(Math.min(Math.max(width, props.min), Math.max(max, props.min)))
  const measured = (handle: HTMLElement) =>
    handle.parentElement?.getBoundingClientRect().width ?? props.width ?? props.min
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={props.width}
      aria-valuemin={props.min}
      tabIndex={0}
      data-slot="resize-handle"
      data-side={props.side}
      className={cn(
        "absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none outline-none select-none after:absolute after:inset-y-0 after:w-px after:transition-colors after:duration-150 hover:after:bg-ring focus-visible:after:w-0.5 focus-visible:after:bg-ring data-dragging:after:bg-ring data-[side=left]:left-0 data-[side=left]:after:left-0 data-[side=right]:right-0 data-[side=right]:after:right-0 motion-reduce:after:transition-none",
        props.className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.dataset.dragging = ""
        const width = measured(event.currentTarget)
        drag.current = { x: event.clientX, width, max: props.max(), current: width }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start) return
        const moved = event.clientX - start.x
        start.current = clamp(start.width + (props.side === "left" ? -moved : moved), start.max)
        props.onResize(start.current)
      }}
      onPointerUp={(event) => {
        const start = drag.current
        if (!start) return
        drag.current = null
        delete event.currentTarget.dataset.dragging
        props.onCommit(start.current)
      }}
      onPointerCancel={(event) => {
        const start = drag.current
        if (!start) return
        drag.current = null
        delete event.currentTarget.dataset.dragging
        props.onResize(start.width)
        props.onCommit(start.width)
      }}
      onFocus={(event) => event.currentTarget.setAttribute("aria-valuemax", String(Math.round(props.max())))}
      onDoubleClick={props.onReset}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const outward = (event.key === "ArrowLeft") === (props.side === "left")
        const next = clamp(measured(event.currentTarget) + (outward ? step : -step), props.max())
        props.onResize(next)
        props.onCommit(next)
      }}
    />
  )
}

export { ResizeHandle }
