import { useState, useSyncExternalStore } from "react"
import type { ComponentPropsWithRef } from "react"
import { readClock, subscribeClock } from "../lib/clock.js"
import { civilDate, formatDateShort } from "../lib/date.js"
import { Badge } from "./badge.js"
import { Button } from "./button.js"
import { Calendar } from "./calendar.js"
import { Icon } from "./icon.js"
import { Notice } from "./notice.js"
import { Popover } from "./popover.js"
import { Select } from "./select.js"
import { Separator } from "./separator.js"

export type TaskControlPresentation = "chip" | "row" | "icon"

const appearances = { chip: "chip", row: "property", icon: "plain" } as const

const placeholders = { chip: "Due date", row: "Set due date", icon: "" }

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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (next) setError(null)
        setOpen(next)
      }}
    >
      <Popover.Trigger
        render={
          <Trigger
            presentation={props.presentation}
            display={display}
            overdue={overdue}
            disabled={locked}
            label={[display || placeholders[props.presentation], overdue ? "overdue" : "", props.label]
              .filter(Boolean)
              .join(", ")}
          />
        }
      />
      <Popover.Content alignment="start" label="Due date">
        <div className="flex flex-col gap-3">
          <Calendar value={value} onSelect={save} initialFocus="day" />
          <Notice tone="danger" placement="inline">
            {error}
          </Notice>
          <div className="flex flex-col gap-2">
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <Button appearance="ghost" size="small" disabled={blocked} onClick={() => save(today)}>
                Today
              </Button>
              {value ? (
                <Button appearance="ghost" size="small" disabled={blocked} onClick={() => save("")}>
                  Clear date
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}

function Trigger(
  props: Omit<ComponentPropsWithRef<"button">, "className" | "style"> & {
    presentation: TaskControlPresentation
    display: string
    overdue: boolean
    label: string
  },
) {
  const { presentation, display, overdue, label, ...rest } = props
  const icon = presentation === "icon"
  const iconShape = display ? "fit" : "square"
  const glyph = <Icon glyph={overdue ? "AlertCircle" : "Calendar"} />
  const content = icon ? (
    <Badge
      appearance={overdue ? "subtle" : "tag"}
      tone={overdue ? "danger" : "neutral"}
      size="medium"
      shape="pill"
      icon={glyph}
    >
      {display}
    </Badge>
  ) : (
    <>
      {glyph}
      {display}
    </>
  )
  return (
    <Select.Button
      {...rest}
      appearance={appearances[presentation]}
      size="small"
      shape={icon ? iconShape : "pill"}
      indicator="none"
      invalid={overdue}
      visibility={icon && !display ? "on-container-hover" : "always"}
      label={label}
      placeholder={
        <>
          <Icon glyph="Calendar" />
          {placeholders[presentation]}
        </>
      }
    >
      {display ? content : null}
    </Select.Button>
  )
}
