import type { ScheduleOrigin } from "@ren/schema/schedule-origin"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { Time } from "@ren/ui/time"
import { IconClock } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"

// oxlint-disable-next-line ren/no-comments -- schedules S13: a message that a schedule sent names the schedule and the time it ran for.
export function ScheduleMessageHeader(props: { origin: ScheduleOrigin.Info | undefined }) {
  const origin = props.origin
  if (!origin) return null
  return (
    <Marker className="justify-end text-xs">
      <MarkerIcon>
        <IconClock />
      </MarkerIcon>
      <MarkerContent>
        Scheduled ·{" "}
        <Link to="/schedules/$scheduleId" params={{ scheduleId: origin.scheduleId }}>
          {origin.name}
        </Link>{" "}
        · <Time value={origin.scheduledAt} format="date-time" />
      </MarkerContent>
    </Marker>
  )
}
