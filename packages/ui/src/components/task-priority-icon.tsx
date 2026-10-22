import { Icon } from "./icon.js"
import type { Glyph } from "./icon.js"

export type TaskPriority = "low" | "medium" | "high"

const priorities: Record<TaskPriority | "none", { glyph: Glyph; label: string }> = {
  none: { glyph: "SignalNone", label: "No priority" },
  low: { glyph: "SignalLow", label: "Low priority" },
  medium: { glyph: "SignalMedium", label: "Medium priority" },
  high: { glyph: "SignalHigh", label: "High priority" },
}

export function TaskPriorityIcon(props: { priority: TaskPriority | null }) {
  return <Icon {...priorities[props.priority ?? "none"]} tone="secondary" size="small" />
}
