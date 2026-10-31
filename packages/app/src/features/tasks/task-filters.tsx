import { useState } from "react"
import { cn } from "cn"
import { IconAdjustmentsHorizontal } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Separator } from "@ren/ui/separator"
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
                <SelectGroup>
                  {choice.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
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
                size="sm"
                aria-pressed={shown}
                className={cn("rounded-full", shown && "border-0")}
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
