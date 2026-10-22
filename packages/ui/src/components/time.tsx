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
  if (props.format === "relative" || props.format === "elapsed") {
    return (
      <RelativeTime
        value={props.value}
        format={props.format}
        timeZone={props.timeZone}
        relativeStyle={props.relativeStyle ?? "long"}
        label={props.label}
      />
    )
  }
  return (
    <TimeElement
      value={props.value}
      title={
        props.label === undefined
          ? undefined
          : `${props.label}: ${formatDateTime(props.value, { timeZone: props.timeZone })}`
      }
    >
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
  timeZone: string | undefined
  relativeStyle: "long" | "narrow"
  label: string | undefined
}) {
  const now = useSyncExternalStore(subscribeClock, readClock, readClock)
  const dateTime = formatDateTime(props.value, { timeZone: props.timeZone })
  return (
    <TimeElement value={props.value} title={props.label === undefined ? dateTime : `${props.label}: ${dateTime}`}>
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
    <time data-slot="time" dateTime={valid ? date.toISOString() : undefined} title={valid ? props.title : undefined}>
      {props.children}
    </time>
  )
}
