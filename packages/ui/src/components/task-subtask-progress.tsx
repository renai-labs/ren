import { Badge } from "./badge.js"

const radius = 5

const circumference = 2 * Math.PI * radius

export function TaskSubtaskProgress(props: { done: number; total: number }) {
  const fraction = props.total === 0 ? 0 : Math.min(props.done / props.total, 1)
  return (
    <Badge
      appearance="outline"
      shape="pill"
      tone="neutral"
      icon={
        <svg viewBox="0 0 14 14" aria-hidden="true" data-slot="task-subtask-progress">
          <circle cx="7" cy="7" r={radius} fill="none" strokeWidth="2" className="stroke-border-secondary" />
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="none"
            strokeWidth="2"
            className="stroke-accent-primary"
            strokeDasharray={`${fraction * circumference} ${circumference}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      }
    >
      <span className="sr-only">
        {props.done} of {props.total} {props.total === 1 ? "sub-task" : "sub-tasks"} done
      </span>
      <span aria-hidden="true">
        {props.done}/{props.total}
      </span>
    </Badge>
  )
}
