export * as TaskLabel from "./task-label.js"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import { labelDisplay, labelTone } from "../lib/label-color.js"
import { Badge } from "./badge.js"
import { StatusDot } from "./status-dot.js"
import { Tooltip } from "./tooltip.js"

export { swatches } from "../lib/label-color.js"

export type Label = { id: string; name: string; color?: string | null }

export function Pill(props: { label: Label }) {
  return (
    <Tooltip.Root content={labelDisplay(props.label.name)}>
      <span
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need the tooltip to read truncated labels
        tabIndex={0}
        className="flex min-w-0 rounded-full focus-visible:outline-2 focus-visible:outline-accent-primary"
      >
        <Badge appearance="tag" size="medium" shape="pill" marker="dot" markerTone={labelTone(props.label)}>
          {labelDisplay(props.label.name)}
        </Badge>
      </span>
    </Tooltip.Root>
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
        <Tooltip.Root content={hidden.map((label) => labelDisplay(label.name)).join(", ")}>
          <span
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need the tooltip to read hidden labels
            tabIndex={0}
            className="flex rounded-full focus-visible:outline-2 focus-visible:outline-accent-primary"
          >
            <Badge appearance="tag" size="medium" shape="pill" tone="muted">
              +{hidden.length}
            </Badge>
          </span>
        </Tooltip.Root>
      ) : null}
      <span aria-hidden="true" className="pointer-events-none invisible absolute flex gap-1" ref={measurement}>
        {props.labels.map((label) => (
          <span key={label.id} className="flex shrink-0">
            <Badge appearance="tag" size="medium" shape="pill" marker="dot" markerTone={labelTone(label)}>
              {labelDisplay(label.name)}
            </Badge>
          </span>
        ))}
      </span>
    </span>
  )
}

export function Dots(props: { labels: ReadonlyArray<Label> }) {
  if (props.labels.length === 0) return null
  return (
    <Tooltip.Root content={props.labels.map((label) => labelDisplay(label.name)).join(", ")}>
      <span
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need the tooltip to identify label dots
        tabIndex={0}
        aria-label={props.labels.map((label) => labelDisplay(label.name)).join(", ")}
        className="flex shrink-0 items-center gap-1 rounded-full focus-visible:outline-2 focus-visible:outline-accent-primary"
      >
        {props.labels.slice(0, 3).map((label) => (
          <StatusDot key={label.id} tone={labelTone(label)} />
        ))}
      </span>
    </Tooltip.Root>
  )
}
