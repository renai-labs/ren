import { IconChevronRight, IconEye, IconEyeOff } from "@tabler/icons-react"
import { useState } from "react"
import { TimelineDetail } from "@ren/chat"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Slider } from "@ren/ui/slider"
import { Switch } from "@ren/ui/switch"
import { Toggle } from "@ren/ui/toggle"

const levels = [
  { id: "text-only", label: "Messages only", description: "Hide all activity." },
  { id: "quiet", label: "Quiet", description: "Show subagents separately and group edits. Hide other activity." },
  {
    id: "compact",
    label: "Compact",
    description: "Show subagents separately. Group other activity with details collapsed.",
  },
  {
    id: "detailed",
    label: "Detailed",
    description: "Expand shell output and edits. Show subagents separately and group other activity.",
  },
  {
    id: "everything",
    label: "Everything",
    description: "Show all activity separately. Expand shell output, edits, and thinking.",
  },
] as const

const rows = [
  { key: "shell", label: "Shell" },
  { key: "edit", label: "Edits" },
  { key: "thinking", label: "Thinking" },
  { key: "subagents", label: "Subagents" },
  { key: "notices", label: "Notices" },
  { key: "tools", label: "Other tools" },
  { key: "commentary", label: "Commentary" },
] as const satisfies ReadonlyArray<{ readonly key: TimelineDetail.Category; readonly label: string }>

export function TimelineDetailSetting(props: {
  value: TimelineDetail.Detail
  onChange: (value: TimelineDetail.Detail) => void
}) {
  const [restore, setRestore] = useState<Partial<Record<TimelineDetail.Category, TimelineDetail.Placement>>>({})
  const preset = TimelineDetail.preset(props.value)
  const index = levels.findIndex((level) => level.id === preset?.id)
  const description = index < 0 ? undefined : levels[index]
  return (
    <div className="flex w-full flex-col gap-3">
      <Slider
        aria-label="Detail"
        min={0}
        max={levels.length - 1}
        step={1}
        value={index < 0 ? [2] : [index]}
        onValueChange={(next) => {
          const level = levels[typeof next === "number" ? next : (next[0] ?? 2)]
          const chosen = TimelineDetail.presets.find((candidate) => candidate.id === level?.id)
          if (chosen) props.onChange(chosen.value)
        }}
      />
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        {levels.map((level) => (
          <span key={level.id} className={level.id === preset?.id ? "font-medium text-foreground" : undefined}>
            {level.label}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {description ? `${description.label}: ${description.description}` : "Custom: Uses advanced settings."}
      </p>
      <Collapsible className="group/advanced">
        <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <IconChevronRight className="size-4 text-muted-foreground transition-transform group-data-open/advanced:rotate-90" />
          Advanced
          {preset ? null : <span className="ml-auto text-xs font-normal text-muted-foreground">Custom</span>}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-3">
          <p className="text-xs text-muted-foreground">Set placement and details for each activity category.</p>
          {rows.map((row) => {
            const current = props.value[row.key]
            const hidden = current.placement === "hidden"
            const change = (next: typeof current) => props.onChange({ ...props.value, [row.key]: next })
            return (
              <div key={row.key} className="flex items-center gap-3 text-sm">
                <Toggle
                  size="sm"
                  aria-label={`Show ${row.label}`}
                  pressed={!hidden}
                  onPressedChange={(pressed) => {
                    if (pressed) change({ ...current, placement: restore[row.key] ?? "grouped" })
                    else {
                      if (current.placement !== "hidden") setRestore({ ...restore, [row.key]: current.placement })
                      change({ ...current, placement: "hidden" })
                    }
                  }}
                >
                  {hidden ? <IconEyeOff /> : <IconEye />}
                </Toggle>
                <span className="min-w-24 flex-1">{row.label}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  Group
                  <Switch
                    size="sm"
                    aria-label={`Group ${row.label}`}
                    disabled={hidden}
                    checked={current.placement === "grouped"}
                    onCheckedChange={(checked) => change({ ...current, placement: checked ? "grouped" : "separate" })}
                  />
                </div>
                {"details" in current ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    Collapse
                    <Switch
                      size="sm"
                      aria-label={`Collapse ${row.label}`}
                      disabled={hidden}
                      checked={current.details === "collapsed"}
                      onCheckedChange={(checked) => change({ ...current, details: checked ? "collapsed" : "expanded" })}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
