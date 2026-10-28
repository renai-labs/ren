import { useSyncExternalStore } from "react"
import { readClock, subscribeClock } from "../lib/clock.js"
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDateTimeInZone,
  formatElapsed,
  formatRelative,
  formatTimeOfDay,
  toDate,
} from "../lib/date.js"
import type { DateInput } from "../lib/date.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js"

type AbsoluteFormat = "date" | "short-date" | "date-time" | "time-of-day"
type RelativeFormat = "relative" | "elapsed"

export type TimeProps = {
  value: DateInput
  format: AbsoluteFormat | RelativeFormat
  timeZone?: string | undefined
  relativeStyle?: "long" | "narrow"
  label?: string
  hint?: "title" | "tooltip"
}

export function Time(props: TimeProps) {
  const dateTime = formatDateTime(props.value, { timeZone: props.timeZone })
  const title = props.label === undefined ? undefined : `${props.label}: ${dateTime}`
  if (props.format === "relative" || props.format === "elapsed") {
    return (
      <RelativeTime
        value={props.value}
        format={props.format}
        relativeStyle={props.relativeStyle ?? "long"}
        title={title ?? dateTime}
        hint={props.hint ?? "title"}
      />
    )
  }
  return (
    <TimeElement value={props.value} title={title} hint={props.hint ?? "title"}>
      {formatAbsolute(props.value, props.format, props.timeZone)}
    </TimeElement>
  )
}

function formatAbsolute(value: DateInput, format: AbsoluteFormat, timeZone: string | undefined) {
  if (format === "date") return formatDate(value, { timeZone })
  if (format === "short-date") return formatDateShort(value, { timeZone })
  if (format === "time-of-day") return formatTimeOfDay(value, { timeZone })
  if (timeZone === undefined) return formatDateTime(value)
  return formatDateTimeInZone(value, timeZone)
}

function RelativeTime(props: {
  value: DateInput
  format: RelativeFormat
  relativeStyle: "long" | "narrow"
  title: string
  hint: "title" | "tooltip"
}) {
  const now = useSyncExternalStore(subscribeClock, readClock, readClock)
  return (
    <TimeElement value={props.value} title={props.title} hint={props.hint}>
      {props.format === "relative"
        ? formatRelative(props.value, now, props.relativeStyle)
        : formatElapsed(props.value, now)}
    </TimeElement>
  )
}

function TimeElement(props: {
  value: DateInput
  title?: string | undefined
  hint: "title" | "tooltip"
  children: string
}) {
  const date = toDate(props.value)
  const valid = !Number.isNaN(date.getTime())
  const title = valid ? props.title : undefined
  const element = (
    <time
      data-slot="time"
      className="tabular-nums"
      dateTime={valid ? date.toISOString() : undefined}
      title={props.hint === "title" ? title : undefined}
    >
      {props.children}
    </time>
  )
  if (props.hint === "title" || title === undefined) return element
  return (
    <Tooltip>
      <TooltipTrigger render={element} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

// oxlint-disable-next-line ren/no-comments -- The viewer's IANA time zone, for example "Europe/Berlin".
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function timeZones() {
  return Intl.supportedValuesOf("timeZone")
}
