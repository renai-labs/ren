import type { ScheduleWhen as When } from "@ren/client"
import { Time } from "@ren/ui/time"
import { Schedules } from "./schedules.js"

// oxlint-disable-next-line ren/no-comments -- A `when` in words: “Every day at 09:00 · Berlin”, or “Once, Oct 28, 9:00 AM” in the viewer's time.
export function ScheduleWhen(props: { when: When }) {
  const when = props.when
  if ("at" in when)
    return (
      <>
        Once, <Time value={when.at} format="date-time" />
      </>
    )
  return Schedules.describe(when)
}
