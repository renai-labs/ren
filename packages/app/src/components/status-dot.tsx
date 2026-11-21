import { cn } from "cn"
import type { Status } from "../lib/apps.js"

export function StatusDot(props: { status: Status }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        props.status === "connected" && "bg-chart-2",
        props.status === "credits" && "bg-muted-foreground",
        (props.status === "expired" || props.status === "missing") && "bg-chart-3",
      )}
    />
  )
}
