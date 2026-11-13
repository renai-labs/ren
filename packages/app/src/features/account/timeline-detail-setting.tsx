import { IconChevronRight, IconEye, IconEyeOff } from "@tabler/icons-react"
import { useId, useState } from "react"
import { TimelineDetail } from "@ren/chat"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Slider } from "@ren/ui/slider"
import { Switch } from "@ren/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"
import { StackedRow } from "../../components/page.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Preference } from "../../lib/preference.js"

const levels = TimelineDetail.presets.toReversed()

const copy = {
  "text-only": { label: "Messages only", description: "Hide all activity." },
  quiet: { label: "Quiet", description: "Show subagents separately and group edits. Hide other activity." },
  compact: {
    label: "Compact",
    description: "Show subagents separately. Group other activity with details collapsed.",
  },
  detailed: {
    label: "Detailed",
    description: "Expand shell output and edits. Show subagents separately and group other activity.",
  },
  everything: {
    label: "Everything",
    description: "Show all activity separately. Expand shell output, edits, and thinking.",
  },
  custom: { label: "Custom", description: "Uses the advanced settings below." },
} as const

const categories = [
  { key: "shell", label: "Shell" },
  { key: "edit", label: "Edits" },
  { key: "thinking", label: "Thinking" },
  { key: "subagents", label: "Subagents" },
  { key: "notices", label: "Notices" },
  { key: "tools", label: "Other tools" },
  { key: "commentary", label: "Commentary" },
] as const satisfies ReadonlyArray<{ readonly key: TimelineDetail.Category; readonly label: string }>

const cell = "flex w-16 shrink-0 items-center justify-center"

function Unavailable() {
  return <span aria-hidden className="h-px w-4 rounded-full bg-muted-foreground/40" />
}

function CategoryRow(props: {
  label: string
  value: TimelineDetail.Detail[TimelineDetail.Category]
  restore: TimelineDetail.Placement | undefined
  onChange: (value: TimelineDetail.Detail[TimelineDetail.Category]) => void
  onHide: (placement: TimelineDetail.Placement) => void
}) {
  const id = useId()
  const current = props.value
  const hidden = current.placement === "hidden"
  return (
    <div className="flex min-h-10 items-center py-1.5 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                id={id}
                variant="ghost"
                size="icon-sm"
                className="-ml-1.5 text-muted-foreground"
                aria-label={`Show ${props.label}`}
                aria-pressed={!hidden}
                onClick={() => {
                  if (hidden) {
                    props.onChange({ ...current, placement: props.restore ?? "grouped" })
                    return
                  }
                  props.onHide(current.placement)
                  props.onChange({ ...current, placement: "hidden" })
                }}
              />
            }
          >
            {hidden ? <IconEyeOff /> : <IconEye />}
          </TooltipTrigger>
          <TooltipContent>{hidden ? "Show" : "Hide"}</TooltipContent>
        </Tooltip>
        <label
          htmlFor={id}
          className={cn("min-w-0 truncate transition-colors duration-150 ease-out", hidden && "text-muted-foreground")}
        >
          {props.label}
        </label>
      </div>
      <div className={cell}>
        {hidden ? (
          <Unavailable />
        ) : (
          <Switch
            size="sm"
            aria-label={`Group ${props.label}`}
            checked={current.placement === "grouped"}
            onCheckedChange={(checked) => props.onChange({ ...current, placement: checked ? "grouped" : "separate" })}
          />
        )}
      </div>
      <div className={cell}>
        {"details" in current && hidden ? <Unavailable /> : null}
        {"details" in current && !hidden ? (
          <Switch
            size="sm"
            aria-label={`Collapse ${props.label}`}
            checked={current.details === "collapsed"}
            onCheckedChange={(checked) => props.onChange({ ...current, details: checked ? "collapsed" : "expanded" })}
          />
        ) : null}
      </div>
    </div>
  )
}

export function TimelineDetailSetting() {
  const value = Preference.usePreference(ChatPreferences.timelineDetail)
  const setPreference = Preference.useSetPreference()
  const [restore, setRestore] = useState<Partial<Record<TimelineDetail.Category, TimelineDetail.Placement>>>({})
  const preset = TimelineDetail.preset(value)
  const level = copy[preset?.id ?? "custom"]
  const change = (next: TimelineDetail.Detail) => setPreference(ChatPreferences.timelineDetail, next)
  return (
    <StackedRow
      title="Timeline detail"
      aside={
        <p aria-live="polite" className="min-w-0 text-xs/5 text-muted-foreground">
          <span className="font-medium text-foreground">{level.label}:</span> {level.description}
        </p>
      }
    >
      <div className="px-2">
        <Slider
          aria-label="Timeline detail"
          thumbAlignment="center"
          marks
          className="**:data-[slot=slider-mark]:ring-card"
          min={0}
          max={levels.length - 1}
          value={levels.findIndex((item) => item.id === (preset?.id ?? "compact"))}
          getAriaValueText={() => level.label}
          onValueChange={(next) => {
            const chosen = levels[typeof next === "number" ? next : -1]
            if (chosen) change(chosen.value)
          }}
        />
      </div>
      <Collapsible defaultOpen={!preset} className="group/advanced flex flex-col">
        <div className="flex items-center justify-between gap-3">
          <CollapsibleTrigger
            render={<Button variant="ghost" size="sm" className="group/trigger -ml-2 text-sm text-foreground" />}
          >
            Advanced
            <IconChevronRight
              data-icon="inline-end"
              className="text-muted-foreground transition-transform duration-150 ease-out group-aria-expanded/trigger:rotate-90 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <div
            aria-hidden
            className="flex text-xs text-muted-foreground opacity-0 transition-opacity duration-150 ease-out group-data-open/advanced:opacity-100"
          >
            <span className={cell}>Group</span>
            <span className={cell}>Collapse</span>
          </div>
        </div>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
          <fieldset className="mt-2 flex min-w-0 flex-col divide-y border-t">
            <legend className="sr-only">Placement and details for each kind of activity</legend>
            {categories.map((category) => (
              <CategoryRow
                key={category.key}
                label={category.label}
                value={value[category.key]}
                restore={restore[category.key]}
                onChange={(next) => change({ ...value, [category.key]: next })}
                onHide={(placement) => setRestore({ ...restore, [category.key]: placement })}
              />
            ))}
          </fieldset>
        </CollapsibleContent>
      </Collapsible>
    </StackedRow>
  )
}
