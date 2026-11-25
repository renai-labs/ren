import type { RenInferenceConnection } from "@ren/client"
import { Progress } from "@ren/ui/progress"
import { formatCountdown, formatDateTime } from "@ren/ui/time"
import { useNow } from "../lib/use-now.js"

export function SubscriptionLimits(props: { limits: RenInferenceConnection["limits"] }) {
  const now = useNow()
  return (
    <ul className="flex flex-col gap-3">
      {props.limits.map((limit) => (
        <li key={limit.key} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate">{limit.title}</span>
            <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
              <span className="font-medium">{limit.percent === null ? "—" : `${limit.percent}%`}</span>
              {limit.resetsAt && Date.parse(limit.resetsAt) > now ? (
                <span className="text-muted-foreground" title={`Resets ${formatDateTime(limit.resetsAt)}`}>
                  {formatCountdown(limit.resetsAt, now)}
                </span>
              ) : null}
            </span>
          </div>
          <Progress
            value={limit.percent ?? 0}
            aria-label={limit.title}
            className="**:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-secondary"
          />
        </li>
      ))}
    </ul>
  )
}
