import { Task } from "@ren/schema/task"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Field, FieldLabel } from "@ren/ui/field"
import { Icon } from "@ren/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { SearchField } from "@ren/ui/search-field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Separator } from "@ren/ui/separator"
import { StatusDot } from "@ren/ui/status-dot"
import { Switch } from "@ren/ui/switch"
import { TaskPriorityIcon } from "@ren/ui/task-priority-icon"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"
import { Text } from "@ren/ui/text"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { useId } from "react"
import type { ReactNode } from "react"
import { Schema } from "effect"
import { PersonAvatar, SpaceAvatar } from "./task-controls.js"
import { TaskSearch } from "./task-search.js"
import { TaskView } from "./task-view.js"
import { FilterMenu } from "../../components/filter-menu.js"

type ViewProps = { view: TaskView.View; onChange: (view: TaskView.View) => void }
type FilterProps = ViewProps & { options: TaskView.FilterOptions }

const propertyLabels: Record<TaskView.FilterProperty | TaskSearch.Property, string> = {
  status: "Status",
  priority: "Priority",
  space: "Space",
  agent: "Agent",
  owner: "Owner",
  label: "Label",
  review: "Human review",
  labels: "Labels",
  due: "Due date",
  created: "Created",
  updated: "Updated",
  links: "Links",
}

const menuProperties: ReadonlyArray<TaskView.FilterProperty> = [
  "space",
  ...TaskView.filterProperties.filter((property) => property !== "space"),
]

const propertyGlyphs: Record<TaskView.FilterProperty, ReactNode> = {
  status: <Icon glyph="ProgressHalf" />,
  priority: <TaskPriorityIcon priority="high" />,
  space: <Icon glyph="Cube" />,
  agent: <Icon glyph="Bot" />,
  owner: <Icon glyph="Users" />,
  label: <Icon glyph="Tag" />,
  review: <Icon glyph="Hand" />,
}

export function TasksToolbar(props: FilterProps) {
  return (
    <>
      <SearchField.Expandable
        value={props.view.query}
        onValueChange={(query) => props.onChange({ ...props.view, query })}
        placeholder="Search tasks"
        size="compact"
      />
      <TaskFilterMenu {...props} />
      <DisplayPopover view={props.view} onChange={props.onChange} />
    </>
  )
}

const isStatus = Schema.is(Task.Status)

const isPriority = Schema.is(Task.Priority)

function OptionIcon(props: { property: TaskView.FilterProperty; option: TaskView.FilterOption }) {
  const none = props.option.value === TaskView.none
  if (props.property === "status")
    return isStatus(props.option.value) ? <TaskStatusCircle status={props.option.value} /> : null
  if (props.property === "priority")
    return <TaskPriorityIcon priority={isPriority(props.option.value) ? props.option.value : null} />
  if (props.property === "label") return <StatusDot tone={props.option.tone} frame="icon" />
  if (props.property === "owner")
    return none ? (
      <Icon glyph="UnassignedPerson" tone="secondary" />
    ) : (
      <PersonAvatar name={props.option.label} image={props.option.image} />
    )
  if (props.property === "review")
    return <Icon glyph={props.option.value === "on" ? "Hand" : "Circle"} tone="secondary" />
  if (props.property === "space") return <SpaceAvatar />
  return <Icon glyph="Bot" tone="secondary" />
}

function TaskFilterMenu(props: FilterProps) {
  return (
    <FilterMenu
      label="Filter tasks"
      properties={menuProperties.map((property) => ({
        key: property,
        label: propertyLabels[property],
        icon: propertyGlyphs[property],
        options: props.options[property].map((option) => ({
          value: option.value,
          label: option.label,
          icon: <OptionIcon property={property} option={option} />,
        })),
      }))}
      values={props.view.filters}
      modified={TaskView.filterProperties.some((property) => !TaskView.isDefaultFilter(props.view.filters, property))}
      onToggle={(change) => {
        const property = menuProperties.find((each) => each === change.key)
        if (!property) return
        const values = props.view.filters[property]
        props.onChange({
          ...props.view,
          filters: {
            ...props.view.filters,
            [property]: change.checked ? [...values, change.value] : values.filter((each) => each !== change.value),
          },
        })
      }}
      onReset={() => props.onChange({ ...props.view, filters: TaskSearch.defaultFilters })}
    />
  )
}

function DisplayPopover(props: ViewProps) {
  const switchId = useId()
  const subtasksId = useId()
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Display options"
            title="Display"
          />
        }
      >
        <Icon glyph="Sliders" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-4 p-4" aria-label="Task display">
        <ToggleGroup
          aria-label="Task layout"
          variant="outline"
          size="sm"
          spacing={0}
          className="w-full"
          value={[props.view.layout]}
          onValueChange={(next) => {
            const layout = next.at(0)
            if (layout === "list" || layout === "board") props.onChange({ ...props.view, layout })
          }}
        >
          <ToggleGroupItem value="list" className="flex-1">
            List
          </ToggleGroupItem>
          <ToggleGroupItem value="board" className="flex-1">
            Board
          </ToggleGroupItem>
        </ToggleGroup>
        {props.view.layout === "board" ? (
          <div className="flex items-center justify-between gap-2">
            <Text purpose="body">Group by</Text>
            <Text purpose="body">Agent (fixed)</Text>
          </div>
        ) : (
          <DisplaySelect
            label="Group by"
            value={props.view.group}
            options={[
              { value: "agent", label: "Agent" },
              { value: "status", label: "Status" },
            ]}
            onChange={(group) => props.onChange({ ...props.view, group })}
          />
        )}
        <DisplaySelect
          label="Order by"
          value={props.view.sort}
          options={[
            { value: "created", label: "Created" },
            { value: "priority", label: "Priority" },
          ]}
          onChange={(sort) => props.onChange({ ...props.view, sort })}
        />
        <DisplaySelect
          label="Direction"
          value={props.view.direction}
          options={[
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ]}
          onChange={(direction) => props.onChange({ ...props.view, direction })}
        />
        {props.view.layout === "list" ? (
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor={switchId} className="font-normal">
              Show empty groups
            </FieldLabel>
            <Switch
              id={switchId}
              checked={props.view.empty}
              onCheckedChange={(empty) => props.onChange({ ...props.view, empty })}
            />
          </Field>
        ) : null}
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor={subtasksId} className="font-normal">
            Show sub-tasks
          </FieldLabel>
          <Switch
            id={subtasksId}
            checked={props.view.subtasks}
            onCheckedChange={(subtasks) => props.onChange({ ...props.view, subtasks })}
          />
        </Field>
        <PropertyToggles view={props.view} onChange={props.onChange} />
      </PopoverContent>
    </Popover>
  )
}

function DisplaySelect<T extends string>(props: {
  label: string
  value: T
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Text purpose="body">{props.label}</Text>
      <Select
        items={props.options}
        value={props.value}
        onValueChange={(next) => {
          if (next !== null) props.onChange(next)
        }}
      >
        <SelectTrigger size="sm" aria-label={props.label} className="w-36 border-transparent bg-muted">
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

function PropertyToggles(props: ViewProps) {
  const key = props.view.layout === "board" ? "boardProperties" : "properties"
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset would add a border and a form context the toggles do not use
      role="group"
      aria-label={props.view.layout === "board" ? "Board properties" : "List properties"}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <Text purpose="body">{props.view.layout === "board" ? "Board properties" : "List properties"}</Text>
        <Separator className="flex-1" />
      </div>
      <div className="flex flex-wrap gap-1">
        {TaskSearch.properties.map((property) => {
          const shown = props.view[key].includes(property)
          return (
            <Button
              key={property}
              variant={shown ? "secondary" : "outline"}
              size="sm"
              className="rounded-full"
              aria-pressed={shown}
              onClick={() =>
                props.onChange({
                  ...props.view,
                  [key]: shown ? props.view[key].filter((value) => value !== property) : [...props.view[key], property],
                })
              }
            >
              {propertyLabels[property]}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export function ActiveFilters(props: FilterProps) {
  const properties = TaskView.filterProperties.filter(
    (property) => property !== "status" || !TaskView.isDefaultFilter(props.view.filters, property),
  )
  if (!properties.some((property) => props.view.filters[property].length > 0)) return null
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset would add a border and a form context the chips do not use
      role="group"
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-2"
    >
      {properties.flatMap((property) => {
        const options = new Map(props.options[property].map((option) => [option.value, option]))
        return props.view.filters[property].map((value) => {
          const option = options.get(value) ?? { value, label: value }
          return (
            <Badge key={`${property}:${value}`} variant="outline" className="h-6.5 gap-1.5 rounded-full pr-0.5">
              <OptionIcon property={property} option={option} />
              {propertyLabels[property]}{" "}
              <Text purpose="caption" tone="primary" element="span">
                {option.label}
              </Text>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5 rounded-full text-muted-foreground"
                aria-label={`Remove ${propertyLabels[property]} filter: ${option.label}`}
                onClick={() =>
                  props.onChange({
                    ...props.view,
                    filters: {
                      ...props.view.filters,
                      [property]: props.view.filters[property].filter((entry) => entry !== value),
                    },
                  })
                }
              >
                <Icon glyph="X" size="extra-small" />
              </Button>
            </Badge>
          )
        })
      })}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => props.onChange({ ...props.view, filters: TaskSearch.defaultFilters })}
      >
        Clear filters
      </Button>
    </div>
  )
}
