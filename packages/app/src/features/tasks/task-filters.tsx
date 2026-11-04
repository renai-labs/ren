import { useState } from "react"
import { cn } from "cn"
import { IconAdjustmentsHorizontal, IconLayoutKanbanFilled, IconLayoutListFilled } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import type { TaskDisplay } from "./task-display.js"

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

function Choice(props: {
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex h-8 items-center justify-between">
      <span className="text-muted-foreground">{props.label}</span>
      <Select items={[...props.options]} value={props.value} onValueChange={(value) => props.onChange(String(value))}>
        <SelectTrigger
          size="sm"
          aria-label={props.label}
          className="h-7 w-32 border-transparent bg-muted hover:bg-secondary dark:bg-muted dark:hover:bg-secondary"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

export function DisplayOptions(props: { value: TaskDisplay.Display; onChange: (value: TaskDisplay.Display) => void }) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<TaskDisplay.Display>) => props.onChange({ ...props.value, ...patch })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Display options" />}
      >
        <IconAdjustmentsHorizontal />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 bg-sidebar p-0">
        <Tabs value={props.value.layout} onValueChange={(layout: string) => set({ layout })} className="p-3">
          <TabsList className="h-9 w-full gap-1">
            <TabsTrigger value="list" className="h-7 gap-1.5 border-0 dark:data-active:bg-secondary">
              <IconLayoutListFilled />
              List
            </TabsTrigger>
            <TabsTrigger value="board" className="h-7 gap-1.5 border-0 dark:data-active:bg-secondary">
              <IconLayoutKanbanFilled />
              Board
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-1 border-t px-3 py-2">
          {displayChoices.map((choice) => (
            <Choice
              key={choice.key}
              label={choice.label}
              options={choice.options}
              value={props.value[choice.key]}
              onChange={(value) => set({ [choice.key]: value })}
            />
          ))}
        </div>
        {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label wraps a Base UI Switch, which renders a button */}
        <label className="flex h-12 items-center justify-between border-t px-3 text-muted-foreground">
          Show empty groups
          <Switch checked={props.value.showEmpty} onCheckedChange={(showEmpty) => set({ showEmpty })} />
        </label>
        <div className="flex flex-col gap-2.5 border-t p-3">
          <span className="font-medium">List options</span>
          <span className="text-muted-foreground">Display properties</span>
          <div className="flex flex-wrap gap-1.5">
            {listProperties.map((property) => {
              const shown = props.value.properties.includes(property.value)
              return (
                <Button
                  key={property.value}
                  variant={shown ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={shown}
                  className={cn(
                    "h-6 rounded-full px-2.5",
                    shown ? "border-transparent" : "bg-transparent text-muted-foreground dark:bg-transparent",
                  )}
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
        </div>
      </PopoverContent>
    </Popover>
  )
}
