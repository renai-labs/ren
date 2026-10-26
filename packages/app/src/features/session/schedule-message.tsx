import type { ScheduleOrigin } from "@ren/schema/schedule-origin"
import { Icon } from "@ren/ui/icon"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Link } from "@tanstack/react-router"

// oxlint-disable-next-line ren/no-comments -- schedules S13: a message that a schedule sent names the schedule and the time it ran for.
export function ScheduleMessageHeader(props: { origin: ScheduleOrigin.Info | undefined }) {
  const origin = props.origin
  if (!origin) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pb-2">
      <Icon glyph="CalendarClock" size="small" tone="secondary" />
      <Text purpose="caption" tone="secondary" element="span" wrapping="anywhere">
        Scheduled ·{" "}
        <Link to="/schedules/$scheduleId" params={{ scheduleId: origin.scheduleId }}>
          {origin.name}
        </Link>{" "}
        · <Time value={origin.scheduledAt} format="date-time" />
      </Text>
    </span>
  )
}
