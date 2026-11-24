import { useState, type ReactElement, type ReactNode } from "react"
import { Button } from "@ren/ui/button"
import { Calendar } from "@ren/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Separator } from "@ren/ui/separator"
import { civilDate } from "@ren/ui/time"

const noonUtc = (day: Date) => `${civilDate(day)}T12:00:00.000Z`

export function DueDatePicker(props: {
  value: string | null
  trigger: ReactElement
  children: ReactNode
  onChange: (value: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const pick = (value: string | null) => {
    props.onChange(value)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={props.trigger}>{props.children}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-1 p-1.5">
        <Calendar
          mode="single"
          selected={props.value ? new Date(props.value) : undefined}
          onSelect={(day: Date | undefined) => pick(day ? noonUtc(day) : null)}
          className="p-0"
        />
        <Separator />
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => pick(noonUtc(new Date()))}>
            Today
          </Button>
          {props.value ? (
            <Button variant="ghost" size="sm" onClick={() => pick(null)}>
              Clear
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
