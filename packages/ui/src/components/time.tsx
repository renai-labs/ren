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

type AbsoluteFormat = "date" | "short-date" | "date-time" | "time-of-day"
type RelativeFormat = "relative" | "elapsed"

export type TimeProps = {
  value: DateInput
  format: AbsoluteFormat | RelativeFormat
  timeZone?: string
  relativeStyle?: "long" | "narrow"
  label?: string
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
      />
    )
  }
  return (
    <TimeElement value={props.value} title={title}>
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
}) {
  const now = useSyncExternalStore(subscribeClock, readClock, readClock)
  return (
    <TimeElement value={props.value} title={props.title}>
      {props.format === "relative"
        ? formatRelative(props.value, now, props.relativeStyle)
        : formatElapsed(props.value, now)}
    </TimeElement>
  )
}

function TimeElement(props: { value: DateInput; title?: string | undefined; children: string }) {
  const date = toDate(props.value)
  const valid = !Number.isNaN(date.getTime())
  return (
    <time
      data-slot="time"
      className="tabular-nums"
      dateTime={valid ? date.toISOString() : undefined}
      title={valid ? props.title : undefined}
    >
      {props.children}
    </time>
  )
}

// oxlint-disable-next-line ren/no-comments -- The viewer's IANA time zone, for example "Europe/Berlin".
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function timeZones() {
  return Intl.supportedValuesOf("timeZone")
}
