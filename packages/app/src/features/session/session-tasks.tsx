import type { SessionTasks as Tasks } from "@ren/chat"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@ren/ui/trace"
import { IconCircle, IconCircleCheck, IconCircleDot, IconCircleX, IconListCheck } from "@tabler/icons-react"
import type { ReactNode } from "react"

const icons: Readonly<Record<Tasks.Status, ReactNode>> = {
  pending: <IconCircle />,
  in_progress: <IconCircleDot />,
  completed: <IconCircleCheck />,
  cancelled: <IconCircleX />,
}

const statusOf = (task: Tasks.Task, session: { readonly running: boolean }) => {
  if (task.status === "in_progress" && session.running) return "running"
  return task.status === "pending" ? "pending" : undefined
}

export function SessionTodos(props: { tasks: ReadonlyArray<Tasks.Task>; running: boolean }) {
  const done = props.tasks.filter((task) => task.status === "completed").length
  const current = props.tasks.find((task) => task.status === "in_progress")
  return (
    <section aria-label="To-dos" className="rounded-xl border bg-card px-4 py-3">
      <Trace>
        <TraceCollapsible defaultOpen>
          <TraceCollapsibleTrigger>
            <TraceLine status={props.running && current ? "running" : undefined}>
              <TraceIcon>
                <IconListCheck />
              </TraceIcon>
              <TraceTitle>{current ? current.content : "To-dos"}</TraceTitle>
              <TraceDescription>
                {done} of {props.tasks.length}
              </TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <Trace className="max-h-48 overflow-y-auto overscroll-contain">
              {props.tasks.map((task) => (
                <TraceLine key={task.id} status={statusOf(task, { running: props.running })}>
                  <TraceIcon>{icons[task.status]}</TraceIcon>
                  <TraceTitle className={task.status === "cancelled" ? "line-through" : undefined}>
                    {task.content}
                  </TraceTitle>
                </TraceLine>
              ))}
            </Trace>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </section>
  )
}
