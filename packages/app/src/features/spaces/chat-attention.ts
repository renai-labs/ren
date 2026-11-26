export * as ChatAttention from "./chat-attention.js"

import { IconCircle, IconHandStop, IconProgress } from "@tabler/icons-react"

export const labels = {
  asking: { label: "Needs input", icon: IconHandStop, className: "text-chart-3" },
  running: { label: "Working", icon: IconProgress, className: "text-chart-2" },
  idle: { label: "Idle", icon: IconCircle, className: "text-muted-foreground" },
} as const
