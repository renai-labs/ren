import type { ScheduleInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { FeatureCard } from "@ren/ui/feature-card"
import { Icon } from "@ren/ui/icon"
import { Switch } from "@ren/ui/switch"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { toast } from "@ren/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { useMutation } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { ScheduleWhen } from "../../components/schedule-when.js"
import { Schedules } from "../../components/schedules.js"
import { RouterContext } from "../../lib/router-context.js"

const switchLabels = { active: "Pause schedule", paused: "Resume schedule", ended: "Schedule ended" } as const

const pauseHints = {
  user: undefined,
  owner_left: "Its owner left the space. Resume it to run it as you.",
  agent_removed: "Its agent left the space. Pick another agent, then resume it.",
  failing: "Its last 5 runs failed. Resume it to try again.",
} as const

// oxlint-disable-next-line ren/no-comments -- ren-v1's schedule card: clicking it edits; the switch pauses or resumes, and an ended schedule's switch is off and locked, with a tooltip that says why.
export function ScheduleCard(props: {
  schedule: ScheduleInfo
  spaceName: string
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  const context = RouterContext.useRouterContext()
  const failed = (title: string) => (error: Error) => toast.add({ type: "error", title, description: error.message })
  const pause = useMutation({
    ...context.api.schedule.pause.mutationOptions(),
    onError: failed("Couldn’t pause the schedule"),
  })
  const resume = useMutation({
    ...context.api.schedule.resume.mutationOptions(),
    onError: failed("Couldn’t resume the schedule"),
  })
  const schedule = props.schedule
  const endedHint = <EndedHint schedule={schedule} />
  const toggle = (
    <Switch
      size="sm"
      checked={!pause.isPending && (resume.isPending || schedule.status === "active")}
      disabled={schedule.status === "ended"}
      onCheckedChange={(checked) => {
        if (pause.isPending || resume.isPending) return
        if (checked) resume.mutate({ id: schedule.id })
        else pause.mutate({ id: schedule.id })
      }}
      aria-label={`${switchLabels[schedule.status]}: ${schedule.name}`}
    />
  )
  return (
    <FeatureCard
      label={`Edit schedule: ${schedule.name}`}
      onSelect={props.onEdit}
      appearanceOrder={props.index}
      media={<Icon glyph="Clock" size="medium" tone="secondary" />}
      title={schedule.name}
      description={
        <>
          {props.spaceName} · <ScheduleWhen when={schedule.when} />
        </>
      }
      metadata={<NextRun schedule={schedule} endedHint={endedHint} />}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Delete schedule: ${schedule.name}`}
            onClick={props.onDelete}
          >
            <Icon glyph="Trash2" />
          </Button>
          {schedule.status === "ended" ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>{toggle}</TooltipTrigger>
              <TooltipContent>{endedHint}</TooltipContent>
            </Tooltip>
          ) : (
            toggle
          )}
        </>
      }
    />
  )
}

function EndedHint(props: { schedule: ScheduleInfo }) {
  const when = props.schedule.when
  if ("at" in when)
    return (
      <span>
        Ended <Time value={when.at} format="date-time" />. Edit its time to run it again.
      </span>
    )
  if (!when.until) return "It ended. Edit its time to run it again."
  return (
    <span>
      Ended <Time value={when.until} format="date-time" timeZone={when.timeZone} />. Edit the end date to resume.
    </span>
  )
}

// oxlint-disable-next-line ren/no-comments -- The next run, relative, with the exact time in a tooltip; otherwise the status, with why it ended or paused. A schedule a person paused shows nothing, as in ren-v1.
function NextRun(props: { schedule: ScheduleInfo; endedHint: ReactNode }) {
  const schedule = props.schedule
  if (schedule.status === "active" && schedule.nextRunAt)
    return (
      <Text purpose="body" numerals="tabular" element="span">
        <Time
          value={schedule.nextRunAt}
          format="relative"
          relativeStyle="narrow"
          timeZone={"cron" in schedule.when ? schedule.when.timeZone : undefined}
          label="Next run"
          hint="tooltip"
        />
      </Text>
    )
  const hint =
    schedule.status === "ended" ? props.endedHint : schedule.pausedReason && pauseHints[schedule.pausedReason]
  if (schedule.status === "paused" && !hint) return null
  const label = (
    <Text purpose="body" numerals="tabular" element="span">
      {Schedules.statusOf(schedule).label}
    </Text>
  )
  if (!hint) return label
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{label}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
