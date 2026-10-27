import { useState } from "react"
import type { AgentInfo, LabelInfo, SpaceInfo, TaskInfo } from "@ren/client"
import {
  IconAdjustmentsHorizontal,
  IconAntennaBars5,
  IconCube,
  IconProgress,
  IconGhost,
  IconTag,
  IconUsers,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { passes, type FilterProperty, type Filters } from "@/components/ren/filter-menu"
import { PriorityIcon, StatusGlyph, priorities, statuses } from "@/components/ren/task-meta"
import type { Member } from "@/hooks/use-members"
import { changeTaskDisplay, type TaskDisplay } from "@/stores/ui"

type Task = TaskInfo

export interface TaskLookups {
  readonly spaces: ReadonlyArray<SpaceInfo>
  readonly agents: ReadonlyArray<AgentInfo>
  readonly members: ReadonlyArray<Member>
  readonly labels: ReadonlyArray<LabelInfo>
}

type TaskProperty = FilterProperty & { value: (task: Task) => string[] }

const propertiesFor = (lookups: TaskLookups): TaskProperty[] => [
  {
    key: "space",
    label: "Space",
    any: "All spaces",
    icon: IconCube,
    single: true,
    options: lookups.spaces.map((space) => ({
      value: space.id,
      label: space.name,
    })),
    value: (task: Task) => [task.spaceId],
  },
  {
    key: "status",
    label: "Status",
    any: "Any",
    icon: IconProgress,
    options: Object.entries(statuses).map(([value, status]) => ({
      value,
      label: status.label,
      icon: (glyph: { className?: string }) => <StatusGlyph status={value} className={glyph.className} />,
    })),
    value: (task: Task) => [task.status],
  },
  {
    key: "priority",
    label: "Priority",
    any: "Any",
    icon: IconAntennaBars5,
    options: [
      { value: "none", label: "No priority" },
      ...Object.entries(priorities).map(([value, label]) => ({ value, label })),
    ].map((option) => ({
      value: option.value,
      label: option.label,
      icon: (glyph: { className?: string }) => (
        <PriorityIcon priority={option.value === "none" ? null : option.value} className={glyph.className} />
      ),
    })),
    value: (task: Task) => [task.priority ?? "none"],
  },
  {
    key: "agent",
    label: "Agent",
    any: "Any",
    icon: IconGhost,
    options: lookups.agents.map((agent) => ({
      value: agent.id,
      label: agent.name,
    })),
    value: (task: Task) => [task.agentId ?? ""],
  },
  {
    key: "owner",
    label: "Owner",
    any: "Any",
    icon: IconUsers,
    options: lookups.members.map((member) => ({
      value: member.id,
      label: member.name,
    })),
    value: (task: Task) => [task.ownerId ?? ""],
  },
  {
    key: "label",
    label: "Label",
    any: "Any",
    icon: IconTag,
    options: lookups.labels.map((label) => ({
      value: label.name,
      label: label.name,
    })),
    value: (task: Task) => task.labels.map((label) => label.name),
  },
]

export const taskProperties = (lookups: TaskLookups): FilterProperty[] => propertiesFor(lookups)

export const countedTaskProperties = (lookups: TaskLookups, tasks: ReadonlyArray<Task>): FilterProperty[] =>
  propertiesFor(lookups).map((property) => ({
    key: property.key,
    label: property.label,
    any: property.any,
    icon: property.icon,
    single: property.single,
    options: property.options.map((option) => ({
      value: option.value,
      label: option.label,
      icon: option.icon,
      count: tasks.filter((task) => property.value(task).includes(option.value)).length,
    })),
  }))

export const matchesFilters = (lookups: TaskLookups, task: Task, filters: Filters) =>
  passes(filters, Object.fromEntries(propertiesFor(lookups).map((property) => [property.key, property.value(task)])))

const displayChoices = [
  {
    key: "groupBy",
    label: "Group by",
    options: [
      { value: "space", label: "Space" },
      { value: "status", label: "Status" },
      { value: "agent", label: "Agent" },
    ],
  },
  {
    key: "orderBy",
    label: "Order by",
    options: [
      { value: "created", label: "Created" },
      { value: "priority", label: "Priority" },
    ],
  },
  {
    key: "direction",
    label: "Direction",
    options: [
      { value: "asc", label: "Ascending" },
      { value: "desc", label: "Descending" },
    ],
  },
] as const

const listProperties = [
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "labels", label: "Labels" },
  { value: "due", label: "Due date" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "links", label: "Links" },
]

export function DisplayOptions(props: { value: TaskDisplay; onChange?: ((value: TaskDisplay) => void) | undefined }) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<TaskDisplay>) => (props.onChange ?? changeTaskDisplay)({ ...props.value, ...patch })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Display options" />
        }
      >
        <IconAdjustmentsHorizontal />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-4 p-4">
        <Tabs value={props.value.layout} onValueChange={(layout: string) => set({ layout })}>
          <TabsList className="h-8 w-full gap-1">
            <TabsTrigger value="list" className="h-6 border-0 text-xs dark:data-active:bg-secondary">
              List
            </TabsTrigger>
            <TabsTrigger value="board" className="h-6 border-0 text-xs dark:data-active:bg-secondary" disabled>
              Board
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {displayChoices.map((choice) => (
          <div key={choice.key} className="flex items-center justify-between">
            <span>{choice.label}</span>
            <Select
              items={[...choice.options]}
              value={props.value[choice.key]}
              onValueChange={(value) => set({ [choice.key]: String(value) })}
            >
              <SelectTrigger
                size="sm"
                aria-label={choice.label}
                className="w-36 border-transparent bg-muted dark:bg-muted"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choice.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label wraps a Base UI Switch, which renders a button */}
        <label className="flex items-center justify-between">
          Show empty groups
          <Switch checked={props.value.showEmpty} onCheckedChange={(showEmpty) => set({ showEmpty })} />
        </label>
        <div className="flex items-center gap-2">
          List properties
          <Separator className="flex-1" />
        </div>
        <div className="-mt-1 flex flex-wrap gap-1">
          {listProperties.map((property) => {
            const shown = props.value.properties.includes(property.value)
            return (
              <Button
                key={property.value}
                variant={shown ? "secondary" : "outline"}
                size="xs"
                aria-pressed={shown}
                className={`h-6.5 rounded-full ${shown ? "border-0" : ""}`}
                onClick={() =>
                  set({
                    properties: shown
                      ? props.value.properties.filter((value) => value !== property.value)
                      : [...props.value.properties, property.value],
                  })
                }
              >
                {property.label}
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
