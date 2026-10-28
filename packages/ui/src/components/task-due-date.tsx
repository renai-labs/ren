import { useState, useSyncExternalStore } from "react"
import type { ComponentProps } from "react"
import { readClock, subscribeClock } from "../lib/clock.js"
import { composeClasses } from "../lib/compose-classes.js"
import { revealOnContainerHover } from "../lib/control-chrome.js"
import { civilDate, formatDateShort, parseCivilDate } from "../lib/date.js"
import { Alert, AlertDescription } from "./alert.js"
import { Badge } from "./badge.js"
import { Button } from "./button.js"
import { Calendar } from "./calendar.js"
import { Icon } from "./icon.js"
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js"
import { Separator } from "./separator.js"

export type TaskControlPresentation = "chip" | "row" | "icon"

const placeholders = { chip: "Due date", row: "Set due date", icon: "" }

const triggers = {
  chip: { variant: "outline", size: "xs", className: "h-7 rounded-full px-3 [&_svg]:size-3.5" },
  row: {
    variant: "ghost",
    size: "default",
    className: "max-w-full justify-start gap-2 px-2 font-normal [&_svg]:text-muted-foreground",
  },
} as const

const fallbackError = "Couldn’t save the due date. Try again."

export type TaskDueDateProps = {
  value: string | null
  closed?: boolean
  presentation: TaskControlPresentation
  label: string
  disabled?: boolean
  onChange?: ((value: string | null) => unknown) | undefined
}

export function TaskDueDate(props: TaskDueDateProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = civilDate(new Date(useSyncExternalStore(subscribeClock, readClock, readClock)))
  const value = props.value ?? ""
  const selected = parseCivilDate(value)
  const display = value ? formatDateShort(`${value}T00:00:00Z`, { timeZone: "UTC" }) : ""
  const overdue = value !== "" && value < today && props.closed !== true
  const locked = props.disabled === true || props.onChange === undefined
  const blocked = locked || pending
  const save = (next: string) => {
    if (blocked) return
    setPending(true)
    setError(null)
    void Promise.try(() => props.onChange?.(next || null)).then(
      () => {
        setPending(false)
        setOpen(false)
      },
      (cause: unknown) => {
        setPending(false)
        setError((cause instanceof Error && cause.message) || fallbackError)
      },
    )
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (next) setError(null)
        setOpen(next)
      }}
    >
      <PopoverTrigger
        disabled={locked}
        render={
          <Trigger
            presentation={props.presentation}
            display={display}
            overdue={overdue}
            label={[display || placeholders[props.presentation], overdue ? "overdue" : "", props.label]
              .filter(Boolean)
              .join(", ")}
          />
        }
      />
      <PopoverContent align="start" aria-label="Due date" className="w-72 gap-2 p-3">
        <Calendar
          mode="single"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- a caller that opens the calendar to pick a day moves focus into the grid
          autoFocus
          {...(selected && { selected, defaultMonth: selected })}
          onSelect={(date: Date | undefined) => {
            if (date) save(civilDate(date))
          }}
          className="w-full p-0"
        />
        {error ? (
          <Alert variant="destructive">
            <Icon glyph="AlertCircle" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Separator />
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="xs" className="h-6.5" disabled={blocked} onClick={() => save(today)}>
            Today
          </Button>
          {value ? (
            <Button variant="ghost" size="xs" className="h-6.5" disabled={blocked} onClick={() => save("")}>
              Clear date
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Trigger(
  props: Omit<ComponentProps<typeof Button>, "className" | "children" | "variant" | "size"> & {
    presentation: TaskControlPresentation
    display: string
    overdue: boolean
    label: string
  },
) {
  const { presentation, display, overdue, label, ...rest } = props
  const glyph = <Icon glyph={overdue ? "AlertCircle" : "Calendar"} />
  if (presentation === "icon" && !display) {
    return (
      <Button
        {...rest}
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        className={composeClasses("text-muted-foreground", revealOnContainerHover)}
      >
        {glyph}
      </Button>
    )
  }
  if (presentation === "icon") {
    return (
      <Button
        {...rest}
        variant="ghost"
        aria-label={label}
        className="h-auto max-w-full rounded-full p-0 hover:bg-transparent aria-expanded:bg-transparent"
      >
        <Badge
          variant={overdue ? "destructive" : "outline"}
          className={composeClasses("h-6 max-w-full rounded-full", !overdue && "bg-muted")}
        >
          {glyph}
          <span className="truncate">{display}</span>
        </Badge>
      </Button>
    )
  }
  return (
    <Button
      {...rest}
      variant={triggers[presentation].variant}
      size={triggers[presentation].size}
      aria-label={label}
      className={composeClasses(
        triggers[presentation].className,
        display ? "text-foreground" : "text-muted-foreground",
        overdue && "text-destructive [&_svg]:text-destructive",
      )}
    >
      {glyph}
      <span className="truncate">{display || placeholders[presentation]}</span>
    </Button>
  )
}
