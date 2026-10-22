import { DayPicker } from "@daypicker/react"
import type { ChevronProps } from "@daypicker/react"
import { Icon } from "../components/icon.js"
import { civilDate, parseCivilDate } from "./date.js"

const navButton =
  "inline-grid size-7 place-items-center rounded-control text-text-secondary transition-standard outline-none hover:bg-fill-primary hover:text-text-primary focus-visible:inset-ring-1 focus-visible:inset-ring-accent-primary aria-disabled:pointer-events-none aria-disabled:opacity-disabled [&_svg]:size-4"

const dayButton =
  "mx-auto inline-grid size-8 place-items-center rounded-control text-sm text-text-primary transition-standard outline-none hover:bg-fill-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary group-data-today/day:underline group-data-today/day:decoration-border-secondary group-data-today/day:underline-offset-4 group-data-selected/day:bg-fill-secondary group-data-selected/day:font-reading-semibold group-data-selected/day:no-underline group-data-disabled/day:pointer-events-none group-data-disabled/day:opacity-disabled"

const classNames = {
  root: "relative w-full text-text-primary",
  months: "relative flex flex-col",
  month: "flex flex-col",
  nav: "absolute top-0 right-0 z-10 flex items-center gap-1",
  button_previous: navButton,
  button_next: navButton,
  month_caption: "mb-3 flex h-7 items-center",
  caption_label: "text-sm font-medium",
  month_grid: "w-full border-collapse",
  weekdays: "grid grid-cols-7",
  weekday: "py-1 text-center text-xs font-regular text-text-secondary",
  weeks: "flex flex-col gap-1",
  week: "grid grid-cols-7",
  day: "group/day flex p-0",
  day_button: dayButton,
  hidden: "invisible",
}

function Chevron(props: ChevronProps) {
  return <Icon glyph={props.orientation === "left" ? "ChevronLeft" : "ChevronRight"} />
}

export type CalendarGridProps = { value: string; onSelect: (value: string) => void; initialFocus?: "none" | "day" }

export function CalendarGrid(props: CalendarGridProps) {
  const selected = parseCivilDate(props.value)
  return (
    <DayPicker
      mode="single"
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- a caller that opens the calendar to pick a day moves focus into the grid
      autoFocus={props.initialFocus === "day"}
      {...(selected && { selected, defaultMonth: selected })}
      onSelect={(date) => {
        if (date) props.onSelect(civilDate(date))
      }}
      classNames={classNames}
      components={{ Chevron }}
    />
  )
}
