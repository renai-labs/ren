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

const triggers = {
  chip: { appearance: "chip", shape: "pill", size: "small" },
  row: { appearance: "property", shape: "pill", size: "small" },
  icon: { appearance: "plain", shape: "square", size: "small" },
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
  const display = value ? formatDateShort(`${value}T00:00:00Z`, { timeZone: "UTC" }) : ""
  const locked = props.disabled === true || props.onChange === undefined
  const blocked = locked || pending
  const save = (next: string) => {
    if (blocked) return
    setPending(true)
    setError(null)
    void Promise.resolve(next === "" ? null : next)
      .then((saved) => props.onChange?.(saved))
      .then(
        () => {
          setPending(false)
          setOpen(false)
        },
        (cause: unknown) => {
          setPending(false)
          setError(cause instanceof Error ? cause.message : fallbackError)
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
            overdue={value !== "" && value < today && props.closed !== true}
            disabled={locked}
            label={`${props.label}: ${display ? `due ${display}` : "no due date"}`}
          />
        }
      />
      <Popover.Content alignment="start" label="Due date">
        <div className="flex flex-col gap-3">
          <Calendar value={value} onSelect={save} />
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
  const trigger = triggers[presentation]
  if (presentation === "icon")
    return (
      <Select.Button
        {...rest}
        {...trigger}
        indicator="none"
        shape={display ? "fit" : "square"}
        invalid={overdue}
        visibility={display ? "always" : "on-container-hover"}
        label={label}
        placeholder={<Icon glyph="Calendar" />}
      >
        {display ? (
          <Badge
            appearance={overdue ? "subtle" : "tag"}
            tone={overdue ? "danger" : "neutral"}
            size="medium"
            shape="pill"
            icon={<Icon glyph="Calendar" />}
          >
            {display}
          </Badge>
        ) : null}
      </Select.Button>
    )
  return (
    <Select.Button
      {...rest}
      {...trigger}
      indicator="none"
      invalid={overdue}
      label={label}
      placeholder={
        <>
          <Icon glyph="Calendar" />
          {presentation === "row" ? "Set due date" : "Due date"}
        </>
      }
    >
      {display ? (
        <>
          <Icon glyph="Calendar" />
          {display}
        </>
      ) : null}
    </Select.Button>
  )
}
