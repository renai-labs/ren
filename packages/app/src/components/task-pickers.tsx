import type { ReactElement, ReactNode } from "react"
import type { TaskInfo } from "@ren/client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { PriorityIcon, StatusGlyph, priorities, statuses } from "./task-meta.js"

type Status = TaskInfo["status"]
type Priority = TaskInfo["priority"]

const isStatus = (value: string): value is Status => Object.keys(statuses).includes(value)
const isPriority = (value: string): value is NonNullable<Priority> => Object.keys(priorities).includes(value)

export function StatusMenu(props: {
  status: Status
  trigger: ReactElement
  children: ReactNode
  onChange: (status: Status) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={props.trigger}>{props.children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={props.status}
          onValueChange={(value: string) => {
            if (isStatus(value)) props.onChange(value)
          }}
        >
          {Object.entries(statuses).map((entry) => (
            <DropdownMenuRadioItem key={entry[0]} value={entry[0]}>
              <StatusGlyph status={entry[0]} />
              {entry[1].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const priorityChoices = [
  { value: "none", label: "No priority" },
  ...Object.entries(priorities).map((entry) => ({ value: entry[0], label: entry[1] })),
]

export function PriorityMenu(props: {
  priority: Priority
  trigger: ReactElement
  children: ReactNode
  onChange: (priority: Priority) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={props.trigger}>{props.children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={props.priority ?? "none"}
          onValueChange={(value: string) => props.onChange(isPriority(value) ? value : null)}
        >
          {priorityChoices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              <PriorityIcon priority={isPriority(choice.value) ? choice.value : null} />
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
