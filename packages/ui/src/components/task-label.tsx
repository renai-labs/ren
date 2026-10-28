export * as TaskLabel from "./task-label.js"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { display, tone } from "../lib/label-color.js"
import { Badge } from "./badge.js"
import { StatusDot } from "./status-dot.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js"

export { display, swatches, tone } from "../lib/label-color.js"

export type Label = { id: string; name: string; color?: string | null }

const tag = "h-6 max-w-40 gap-2 rounded-full bg-muted"

function LabelName(props: { label: Label }) {
  return (
    <>
      <StatusDot tone={tone(props.label)} />
      <span className="truncate">{display(props.label.name)}</span>
    </>
  )
}

export function Pill(props: { label: Label }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" className={composeClasses(tag, "min-w-0 shrink")} />}>
        <LabelName label={props.label} />
      </TooltipTrigger>
      <TooltipContent>{display(props.label.name)}</TooltipContent>
    </Tooltip>
  )
}

export function Chips(props: { labels: ReadonlyArray<Label> }) {
  const container = useRef<HTMLSpanElement>(null)
  const measurement = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(props.labels.length)
  const measure = useEffectEvent(() => {
    const widths = [...(measurement.current?.children ?? [])].map((item) => item.getBoundingClientRect().width)
    const available = container.current?.clientWidth ?? 0
    const total = widths.reduce((sum, width) => sum + width, 0) + 4 * (widths.length - 1)
    if (total <= available) {
      setVisible(props.labels.length)
      return
    }
    const fit = widths.reduce(
      (state, width) => {
        const next = state.used + (state.count > 0 ? 4 : 0) + width
        return state.full || next + 40 > available
          ? { used: state.used, count: state.count, full: true }
          : { used: next, count: state.count + 1, full: false }
      },
      { used: 0, count: 0, full: false },
    )
    setVisible(Math.max(fit.count, 1))
  })
  useEffect(() => {
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => measure())
    })
    if (container.current) observer.observe(container.current)
    if (measurement.current) observer.observe(measurement.current)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  const shown = props.labels.slice(0, visible)
  const hidden = props.labels.slice(visible)
  return (
    <span ref={container} className="relative flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map((label) => (
        <Pill key={label.id} label={label} />
      ))}
      {hidden.length > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<Badge variant="outline" className={composeClasses(tag, "text-muted-foreground")} />}>
            +{hidden.length}
          </TooltipTrigger>
          <TooltipContent>{hidden.map((label) => display(label.name)).join(", ")}</TooltipContent>
        </Tooltip>
      ) : null}
      <span aria-hidden="true" className="pointer-events-none invisible absolute flex gap-1" ref={measurement}>
        {props.labels.map((label) => (
          <span key={label.id} className="flex shrink-0">
            <Badge variant="outline" className={tag}>
              <LabelName label={label} />
            </Badge>
          </span>
        ))}
      </span>
    </span>
  )
}

export function Dots(props: { labels: ReadonlyArray<Label> }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-1">
      {props.labels.slice(0, 3).map((label) => (
        <StatusDot key={label.id} tone={tone(label)} />
      ))}
    </span>
  )
}
