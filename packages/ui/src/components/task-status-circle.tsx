import { Icon } from "./icon.js"
import type { Glyph, IconTone } from "./icon.js"

export type TaskStatus = "todo" | "in_progress" | "done" | "dismissed"

const statuses: Record<TaskStatus, { glyph: Glyph; tone: IconTone; label: string }> = {
  todo: { glyph: "ProgressEmpty", tone: "secondary", label: "Todo" },
  in_progress: { glyph: "ProgressHalf", tone: "warning", label: "In progress" },
  done: { glyph: "ProgressComplete", tone: "accent", label: "Done" },
  dismissed: { glyph: "ProgressDismissed", tone: "secondary", label: "Dismissed" },
}

export function TaskStatusCircle(props: { status: TaskStatus }) {
  return <Icon {...statuses[props.status]} />
}
