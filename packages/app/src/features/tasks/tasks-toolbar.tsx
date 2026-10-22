import { Task } from "@ren/schema/task"
import { Avatar } from "@ren/ui/avatar"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Menu } from "@ren/ui/menu"
import { Popover } from "@ren/ui/popover"
import { SearchField } from "@ren/ui/search-field"
import { Select } from "@ren/ui/select"
import { SegmentedControl } from "@ren/ui/segmented-control"
import { Separator } from "@ren/ui/separator"
import { StatusDot } from "@ren/ui/status-dot"
import { Switch } from "@ren/ui/switch"
import { TaskPriorityIcon } from "@ren/ui/task-priority-icon"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"
import { Text } from "@ren/ui/text"
import { useId } from "react"
import type { ReactNode } from "react"
import { Schema } from "effect"
import { TaskSearch } from "./task-search.js"
import { TaskView } from "./task-view.js"

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
      <FilterMenu {...props} />
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
      <Avatar.Root name={props.option.label} image={props.option.image} size="extra-small" decorative />
    )
  if (props.property === "review")
    return <Icon glyph={props.option.value === "on" ? "Hand" : "Circle"} tone="secondary" />
  if (props.property === "space")
    return <Avatar.Root name={props.option.label} glyph="Cube" size="extra-small" shape="square" decorative />
  return <Icon glyph="Bot" tone="secondary" />
}

function FilterMenu(props: FilterProps) {
  const modified = TaskView.filterProperties.some((property) => !TaskView.isDefaultFilter(props.view.filters, property))
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            label={modified ? "Filter tasks, filters on" : "Filter tasks"}
            indicator={modified ? "attention" : "none"}
          >
            <Icon glyph="ListFilter" />
          </IconButton>
        }
      />
      <Menu.Popup alignment="end" width="medium" density="spacious">
        <Menu.Section label="Properties">
          {menuProperties.map((property) => {
            const values = props.view.filters[property]
            return (
              <Menu.SubmenuRoot key={property}>
                <Menu.SubmenuTrigger
                  icon={propertyGlyphs[property]}
                  detail={values.length > 0 ? `${values.length} selected` : "Any"}
                >
                  {propertyLabels[property]}
                </Menu.SubmenuTrigger>
                <Menu.SubmenuPopup>
                  {props.options[property].map((option) => (
                    <Menu.CheckboxItem
                      key={option.value}
                      checked={values.includes(option.value)}
                      onCheckedChange={(checked) =>
                        props.onChange({
                          ...props.view,
                          filters: {
                            ...props.view.filters,
                            [property]: checked
                              ? [...values, option.value]
                              : values.filter((value) => value !== option.value),
                          },
                        })
                      }
                      icon={<OptionIcon property={property} option={option} />}
                    >
                      {option.label}
                    </Menu.CheckboxItem>
                  ))}
                  {props.options[property].length === 0 ? <Menu.Message>No options</Menu.Message> : null}
                </Menu.SubmenuPopup>
              </Menu.SubmenuRoot>
            )
          })}
        </Menu.Section>
        <Menu.Separator />
        <Menu.Item
          icon={<Icon glyph="Restore" />}
          disabled={!modified}
          onSelect={() => props.onChange({ ...props.view, filters: TaskSearch.defaultFilters })}
        >
          Reset to default
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  )
}

function DisplayPopover(props: ViewProps) {
  const switchId = useId()
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <IconButton label="Display options" title="Display">
            <Icon glyph="Sliders" />
          </IconButton>
        }
      />
      <Popover.Content alignment="end" padding="large" label="Task display">
        <div className="flex flex-col gap-4">
          <SegmentedControl
            label="Task layout"
            width="full"
            size="small"
            value={props.view.layout}
            onValueChange={(layout) => props.onChange({ ...props.view, layout })}
            options={[
              { value: "list", label: "List" },
              { value: "board", label: "Board" },
            ]}
          />
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
            <div className="flex items-center justify-between gap-2">
              <Text purpose="body" element="label" htmlFor={switchId}>
                Show empty groups
              </Text>
              <Switch
                id={switchId}
                checked={props.view.empty}
                onCheckedChange={(empty) => props.onChange({ ...props.view, empty })}
              />
            </div>
          ) : null}
          <PropertyToggles view={props.view} onChange={props.onChange} />
        </div>
      </Popover.Content>
    </Popover.Root>
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
      <span className="shrink-0">
        <Select.Root<T>
          value={props.value}
          onValueChange={props.onChange}
          label={props.label}
          appearance="filled"
          size="compact"
          width="compact"
          options={props.options}
        />
      </span>
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
        <span className="flex flex-1 items-center">
          <Separator />
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {TaskSearch.properties.map((property) => {
          const shown = props.view[key].includes(property)
          return (
            <Button
              key={property}
              shape="pill"
              size="small"
              appearance={shown ? "secondary" : "outline"}
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
            <Badge
              key={`${property}:${value}`}
              appearance="outline"
              shape="pill"
              size="medium"
              icon={<OptionIcon property={property} option={option} />}
              onRemove={() =>
                props.onChange({
                  ...props.view,
                  filters: {
                    ...props.view.filters,
                    [property]: props.view.filters[property].filter((entry) => entry !== value),
                  },
                })
              }
              removeLabel={`Remove ${propertyLabels[property]} filter: ${option.label}`}
            >
              {propertyLabels[property]}{" "}
              <Text purpose="caption" tone="primary" element="span">
                {option.label}
              </Text>
            </Badge>
          )
        })
      })}
      <Button
        appearance="plain"
        size="small"
        onClick={() => props.onChange({ ...props.view, filters: TaskSearch.defaultFilters })}
      >
        Clear filters
      </Button>
    </div>
  )
}
