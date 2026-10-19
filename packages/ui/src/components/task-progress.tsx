import { Collapsible } from "@base-ui/react/collapsible"
import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"
import { Icon } from "./icon.js"
import { ProgressIndicator } from "./progress-indicator.js"
import { Text } from "./text.js"

export type TaskStatus = "pending" | "in-progress" | "completed" | "cancelled"

export type TaskProgressItem = {
  id: string
  content: string
  status: TaskStatus
}

export type TaskProgressProps = {
  tasks: ReadonlyArray<TaskProgressItem>
  defaultOpen?: boolean
}

const statusLabel: Record<TaskStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
}

const contentVariants = cva("min-w-0 flex-1", {
  variants: {
    status: {
      pending: "",
      "in-progress": "",
      completed: "line-through",
      cancelled: "line-through",
    },
  },
})

function StatusGlyph(props: { status: TaskStatus }) {
  if (props.status === "in-progress") return <ProgressIndicator size="small" announcement="none" />
  if (props.status === "completed") return <Icon glyph="CircleCheck" tone="success" />
  if (props.status === "cancelled") return <Icon glyph="X" tone="secondary" />
  return <Icon glyph="Circle" tone="secondary" />
}

function Task(props: { task: TaskProgressItem }) {
  const settled = props.task.status === "completed" || props.task.status === "cancelled"
  return (
    <li data-slot="task-progress-item" className="flex min-h-8 min-w-0 items-start gap-2 px-3 py-1.5">
      <span className="flex h-5 shrink-0 items-center">
        <StatusGlyph status={props.task.status} />
      </span>
      <span className={composeClasses(contentVariants({ status: props.task.status }))}>
        <Text purpose="body" tone={settled ? "secondary" : "primary"} element="span">
          {props.task.content}
        </Text>
        <span className="sr-only">, {statusLabel[props.task.status].toLowerCase()}</span>
      </span>
    </li>
  )
}

export function TaskProgress(props: TaskProgressProps) {
  const done = props.tasks.filter((task) => task.status === "completed").length
  const current =
    props.tasks.find((task) => task.status === "in-progress") ??
    props.tasks.find((task) => task.status === "pending") ??
    props.tasks.at(-1)
  if (!current) return null
  return (
    <section
      aria-label="Tasks"
      data-slot="task-progress"
      className="flex min-w-0 flex-col rounded-container border border-border-primary bg-background-secondary"
    >
      <Collapsible.Root defaultOpen={props.defaultOpen ?? false} className="flex min-w-0 flex-col">
        <Collapsible.Trigger className="group/tasks flex min-h-10 w-full min-w-0 items-center gap-2 rounded-container px-3 text-start transition-standard outline-none hover:bg-fill-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary">
          <span className="flex shrink-0 items-center">
            <StatusGlyph status={current.status} />
          </span>
          <span className="min-w-0 flex-1">
            <Text purpose="body" truncation="single-line" element="span">
              {current.content}
            </Text>
          </span>
          <Text purpose="caption" tone="secondary" element="span">
            {done} of {props.tasks.length} done
          </Text>
          <span className="flex shrink-0 text-text-secondary transition-standard group-data-panel-open/tasks:rotate-180 motion-reduce:transition-none">
            <Icon glyph="ChevronUp" />
          </span>
        </Collapsible.Trigger>
        <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-extended data-ending-style:h-0 data-starting-style:h-0">
          <ol className="flex max-h-60 min-w-0 flex-col overflow-y-auto overscroll-contain border-t border-border-primary py-1">
            {props.tasks.map((task) => (
              <Task key={task.id} task={task} />
            ))}
          </ol>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  )
}
