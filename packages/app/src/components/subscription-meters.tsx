import type { RenInferenceConnection } from "@ren/client"
import { Progress } from "@ren/ui/progress"
import { formatCountdown, formatDateTime } from "@ren/ui/time"
import { useNow } from "../lib/use-now.js"

export function SubscriptionMeters(props: { meters: RenInferenceConnection["meters"] }) {
  const now = useNow()
  return (
    <ul className="flex flex-col gap-3">
      {props.meters.map((meter) => (
        <li key={meter.key} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate">{meter.title}</span>
            <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
              <span className="font-medium">{meter.percent === null ? "—" : `${meter.percent}%`}</span>
              {meter.resetsAt && Date.parse(meter.resetsAt) > now ? (
                <span className="text-muted-foreground" title={`Resets ${formatDateTime(meter.resetsAt)}`}>
                  {formatCountdown(meter.resetsAt, now)}
                </span>
              ) : null}
            </span>
          </div>
          <Progress
            value={meter.percent ?? 0}
            aria-label={meter.title}
            className="**:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-secondary"
          />
        </li>
      ))}
    </ul>
  )
}
