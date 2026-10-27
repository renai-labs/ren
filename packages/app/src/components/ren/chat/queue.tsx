import type { SessionTasks } from "@ren/chat"
import { IconCircle, IconCircleCheck, IconCircleDot, IconCircleX, IconListCheck } from "@tabler/icons-react"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"

const icons = {
  pending: <IconCircle />,
  in_progress: <IconCircleDot />,
  completed: <IconCircleCheck />,
  cancelled: <IconCircleX />,
} as const

export function Queue(props: { tasks: ReadonlyArray<SessionTasks.Task>; running: boolean }) {
  const done = props.tasks.filter((task) => task.status === "completed").length
  const current = props.tasks.find((task) => task.status === "in_progress")
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
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
                <TraceLine
                  key={task.id}
                  status={
                    task.status === "in_progress" && props.running
                      ? "running"
                      : task.status === "pending"
                        ? "pending"
                        : undefined
                  }
                >
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
    </div>
  )
}
