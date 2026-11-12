import { IconCircleCheck, IconCircleX, IconClock, IconMinus, IconProgress } from "@tabler/icons-react"
import { cn } from "cn"
import type { Automations } from "../../lib/automations.js"

const tones = {
  done: { icon: IconCircleCheck, className: "text-chart-2" },
  working: { icon: IconProgress, className: "text-chart-1" },
  failed: { icon: IconCircleX, className: "text-destructive" },
  waiting: { icon: IconClock, className: "text-muted-foreground" },
  quiet: { icon: IconMinus, className: "text-muted-foreground" },
} as const

export function RunStatus(props: { tone: Automations.Tone; children: React.ReactNode }) {
  const tone = tones[props.tone]
  const Icon = tone.icon
  return (
    <span className="flex items-center gap-2">
      <Icon aria-hidden className={cn("size-4 shrink-0", tone.className)} />
      {props.children}
    </span>
  )
}
