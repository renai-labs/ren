import { cn } from "cn"
import type { Status } from "../lib/apps.js"

export function StatusDot(props: { status: Status }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        (props.status === "connected" || props.status === "credits") && "bg-chart-2",
        (props.status === "expired" || props.status === "missing") && "bg-chart-3",
      )}
    />
  )
}
