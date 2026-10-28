import type { ScheduleInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@ren/ui/card"
import { Icon } from "@ren/ui/icon"
import { Switch } from "@ren/ui/switch"
import { Time } from "@ren/ui/time"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { ScheduleActions } from "../../components/schedule-actions.js"
import { ScheduleWhen } from "../../components/schedule-when.js"
import { Schedules } from "../../components/schedules.js"

const switchLabels = { active: "Pause schedule", paused: "Resume schedule", ended: "Schedule ended" } as const

const pauseHints = {
  owner_left: "Its owner left the space. Resume it to run it as you.",
  agent_removed: "Its agent left the space. Pick another agent, then resume it.",
  failing: "Its last 5 runs failed. Resume it to try again.",
} as const

// oxlint-disable-next-line ren/no-comments -- ren-v1's schedule card: the name is a button stretched over the card that edits; archive and the pause switch sit above it, and an ended schedule's switch is off and locked, with a tooltip that says why.
export function ScheduleCard(props: { schedule: ScheduleInfo; spaceName: string }) {
  const schedule = props.schedule
  const actions = ScheduleActions.useActions(schedule)
  const active = schedule.status === "active"
  const toggle = (
    <Switch
      size="sm"
      checked={actions.isToggling ? !active : active}
      disabled={schedule.status === "ended"}
      onCheckedChange={() => {
        if (!actions.isToggling) actions.toggle?.onSelect()
      }}
      aria-label={`${switchLabels[schedule.status]}: ${schedule.name}`}
    />
  )
  return (
    <Card className="relative min-h-26 min-w-0 gap-3 overflow-visible border ring-0 transition-standard has-[[data-slot=card-title]>button:active]:scale-99 has-[[data-slot=card-title]>button:hover]:bg-muted">
      <CardHeader className="gap-1">
        <div className="mb-2 flex">
          <Icon glyph="Clock" size="medium" tone="secondary" />
        </div>
        <CardTitle className="min-w-0 text-sm">
          <Button
            variant="ghost"
            onClick={actions.edit}
            className="h-auto w-full min-w-0 justify-start rounded-none border-0 p-0 after:absolute after:inset-0 after:rounded-xl hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-100"
          >
            <span className="truncate">{schedule.name}</span>
          </Button>
        </CardTitle>
        <CardDescription className="line-clamp-2 text-xs text-pretty">
          {props.spaceName} · <ScheduleWhen when={schedule.when} />
        </CardDescription>
      </CardHeader>
      <CardAction className="absolute top-3 right-3 z-10 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Archive schedule: ${schedule.name}`}
          onClick={actions.archive}
        >
          <Icon glyph="Trash2" />
        </Button>
        {schedule.status === "ended" ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>{toggle}</TooltipTrigger>
            <TooltipContent>
              <EndedHint schedule={schedule} />
            </TooltipContent>
          </Tooltip>
        ) : (
          toggle
        )}
      </CardAction>
      <NextRun schedule={schedule} />
      {actions.dialogs}
    </Card>
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

// oxlint-disable-next-line ren/no-comments -- The next run, relative, with the exact time in a tooltip; otherwise the status, with why it ended or paused. A schedule a person paused shows nothing, as in ren-v1. The content sits above the stretched button so its tooltip opens.
function NextRun(props: { schedule: ScheduleInfo }) {
  const schedule = props.schedule
  if (schedule.pausedReason === "user") return null
  const label = Schedules.statusOf(schedule).label
  const hint = schedule.pausedReason ? pauseHints[schedule.pausedReason] : undefined
  return (
    <CardFooter className="mt-auto border-t-0 bg-transparent pt-0 tabular-nums">
      <span className="relative z-10">
        {schedule.status === "active" && schedule.nextRunAt ? (
          <Time
            value={schedule.nextRunAt}
            format="relative"
            relativeStyle="narrow"
            timeZone={"cron" in schedule.when ? schedule.when.timeZone : undefined}
            label="Next run"
          />
        ) : (
          <Tooltip disabled={schedule.status !== "ended" && !hint}>
            <TooltipTrigger render={<span />}>{label}</TooltipTrigger>
            <TooltipContent>{hint ?? <EndedHint schedule={schedule} />}</TooltipContent>
          </Tooltip>
        )}
      </span>
    </CardFooter>
  )
}
