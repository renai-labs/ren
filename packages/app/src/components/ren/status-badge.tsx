import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type StatusTone = "ok" | "warn" | "error" | "neutral"

const tones: Record<StatusTone, string> = {
  ok: "bg-chart-2/10 text-chart-2",
  warn: "bg-chart-3/10 text-chart-3",
  error: "bg-destructive/10 text-destructive",
  neutral: "",
}

export function StatusBadge(props: { tone: StatusTone; children: ReactNode }) {
  return (
    <Badge variant="secondary" className={cn("h-6", tones[props.tone])}>
      {props.children}
    </Badge>
  )
}
