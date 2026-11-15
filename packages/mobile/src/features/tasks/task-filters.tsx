import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import IconX from "@tabler/icons-react-native/IconX"
import { cn } from "cn"
import { useState, type ReactNode } from "react"
import { Pressable, ScrollView, Switch, View } from "react-native"
import ArrowDownIcon from "react-native-heroicons/mini/ArrowDownIcon"
import ArrowUpIcon from "react-native-heroicons/mini/ArrowUpIcon"
import ChevronLeftIcon from "react-native-heroicons/mini/ChevronLeftIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import CubeIcon from "react-native-heroicons/mini/CubeIcon"
import { Avatar } from "#components/avatar"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Segmented } from "#components/segmented"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"
import {
  displayDefaults,
  LabelDot,
  priorityOptions,
  statusOptions,
  type Display,
  type TaskLookups,
} from "#features/tasks/task-meta"
import { OptionList, SheetTitle, type Option } from "#components/option-sheet"

interface FilterProperty {
  readonly key: string
  readonly label: string
  readonly any: string
  readonly single?: boolean
  readonly options: ReadonlyArray<Option>
}

type Filters = Display["filters"]

const filterProperties = (lookups: TaskLookups): ReadonlyArray<FilterProperty> => [
  { key: "status", label: "Status", any: "Any", options: statusOptions },
  { key: "priority", label: "Priority", any: "Any", options: priorityOptions },
  {
    key: "agent",
    label: "Agent",
    any: "Any",
    options: lookups.agents.map((agent) => ({
      value: agent.id,
      label: agent.name,
      icon: <Icon as={IconGhostFilled} className="size-4 text-muted-foreground" />,
    })),
  },
  {
    key: "owner",
    label: "Owner",
    any: "Any",
    options: lookups.members.map((member) => ({
      value: member.id,
      label: member.name,
      icon: <Avatar size="sm" name={member.name} />,
    })),
  },
  {
    key: "label",
    label: "Label",
    any: "Any",
    options: lookups.labels.map((label) => ({
      value: label.name,
      label: label.name,
      icon: <LabelDot color={label.color} />,
    })),
  },
  {
    key: "space",
    label: "Space",
    any: "All spaces",
    single: true,
    options: lookups.spaces.map((space) => ({
      value: space.id,
      label: space.name,
      icon: <Icon as={CubeIcon} className="size-4 text-muted-foreground" />,
    })),
  },
]

const summary = (property: FilterProperty, selected: ReadonlyArray<string>) => {
  if (selected.length === 0) return property.any
  if (selected.length > 1) return `${selected.length} selected`
  return property.options.find((option) => option.value === selected.at(0))?.label ?? selected.at(0)
}

const isFiltered = (filters: Filters) => Object.values(filters).some((values) => values.length > 0)

function TaskFilterChips(props: {
  readonly properties: ReadonlyArray<FilterProperty>
  readonly filters: Filters
  readonly onChange: (filters: Filters) => void
}) {
  const on = props.properties.filter((property) => (props.filters[property.key] ?? []).length > 0)
  if (on.length === 0) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 px-4 pb-2">
      {on.map((property) => (
        <View key={property.key} className="h-8 flex-row items-center rounded-full border border-border pl-3">
          <Text className="text-sm text-muted-foreground">{property.label}: </Text>
          <Text className="max-w-40 text-sm" numberOfLines={1}>
            {summary(property, props.filters[property.key] ?? [])}
          </Text>
          <Pressable
            role="button"
            aria-label={`Remove ${property.label} filter`}
            hitSlop={6}
            className="h-full justify-center pr-2.5 pl-1.5"
            onPress={() => props.onChange({ ...props.filters, [property.key]: [] })}
          >
            <Icon as={IconX} className="size-3.5 text-muted-foreground" />
          </Pressable>
        </View>
      ))}
      <Button variant="ghost" size="sm" className="h-8 rounded-full" onPress={() => props.onChange({})}>
        <Text className="text-sm text-muted-foreground">Clear</Text>
      </Button>
    </ScrollView>
  )
}

const groupChoices = [
  { value: "status", label: "Status" },
  { value: "space", label: "Space" },
  { value: "agent", label: "Agent" },
] as const

const orderChoices = [
  { value: "created", label: "Created" },
  { value: "priority", label: "Priority" },
] as const

function Row(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <View className="min-h-11 flex-row items-center gap-3 px-5">
      <Text className="w-22 text-sm text-muted-foreground">{props.label}</Text>
      <View className="flex-1 flex-row items-center gap-2">{props.children}</View>
    </View>
  )
}

function DisplayPage(props: {
  readonly display: Display
  readonly properties: ReadonlyArray<FilterProperty>
  readonly onChange: (display: Display) => void
  readonly onOpen: (key: string) => void
  readonly onDone: () => void
}) {
  const display = props.display
  const set = (patch: Partial<Display>) => props.onChange({ ...display, ...patch })
  const descending = display.direction === "desc"
  return (
    <>
      <SheetTitle>Filter & display</SheetTitle>
      <ScrollView>
        <Row label="Group by">
          <View className="flex-1">
            <Segmented
              label="Group by"
              options={groupChoices}
              value={display.groupBy}
              onChange={(groupBy) => set({ groupBy })}
            />
          </View>
        </Row>
        <Row label="Order by">
          <View className="flex-1">
            <Segmented
              label="Order by"
              options={orderChoices}
              value={display.orderBy}
              onChange={(orderBy) => set({ orderBy })}
            />
          </View>
          <Button
            variant="secondary"
            size="icon"
            aria-label={descending ? "Descending" : "Ascending"}
            onPress={() => set({ direction: descending ? "asc" : "desc" })}
          >
            <Icon as={descending ? ArrowDownIcon : ArrowUpIcon} className="size-4.5" />
          </Button>
        </Row>
        <View className="min-h-12 flex-row items-center justify-between px-5">
          <Text>Show empty groups</Text>
          <Switch
            aria-label="Show empty groups"
            value={display.showEmpty}
            onValueChange={(showEmpty) => set({ showEmpty })}
          />
        </View>
        <Text className="px-5 pt-3 pb-1 text-sm text-muted-foreground">Filter</Text>
        {props.properties.map((property) => (
          <Pressable
            key={property.key}
            role="button"
            className="min-h-11 flex-row items-center gap-3 px-5 active:bg-accent"
            onPress={() => props.onOpen(property.key)}
          >
            <Text className="flex-1">{property.label}</Text>
            <Text
              className={cn(
                "max-w-44 text-sm",
                (display.filters[property.key] ?? []).length > 0 ? "text-foreground" : "text-muted-foreground",
              )}
              numberOfLines={1}
            >
              {summary(property, display.filters[property.key] ?? [])}
            </Text>
            <Icon as={ChevronRightIcon} className="size-4.5 text-muted-foreground" />
          </Pressable>
        ))}
      </ScrollView>
      <View className="flex-row gap-2 px-5 pt-3">
        <Button variant="secondary" className="flex-1" onPress={() => props.onChange(displayDefaults)}>
          <Text>Reset</Text>
        </Button>
        <Button className="flex-1" onPress={props.onDone}>
          <Text>Done</Text>
        </Button>
      </View>
    </>
  )
}

function TaskDisplaySheet(props: {
  readonly open: boolean
  readonly display: Display
  readonly properties: ReadonlyArray<FilterProperty>
  readonly onChange: (display: Display) => void
  readonly onClose: () => void
}) {
  const [page, setPage] = useState<string>()
  const property = props.properties.find((each) => each.key === page)
  const close = () => {
    setPage(undefined)
    props.onClose()
  }
  const selected = property ? (props.display.filters[property.key] ?? []) : []
  const setFilter = (key: string, values: ReadonlyArray<string>) =>
    props.onChange({ ...props.display, filters: { ...props.display.filters, [key]: values } })
  return (
    <Sheet open={props.open} onClose={close}>
      {property ? (
        <>
          <View className="flex-row items-center gap-1 px-2 pb-2">
            <Button variant="ghost" size="sm" aria-label="Back to filters" onPress={() => setPage(undefined)}>
              <Icon as={ChevronLeftIcon} className="size-5" />
              <Text>Filter</Text>
            </Button>
            <Text role="heading" aria-level={2} className="text-base font-semibold">
              {property.label}
            </Text>
          </View>
          <OptionList
            options={property.single ? [{ value: "", label: property.any }, ...property.options] : property.options}
            selected={property.single ? [selected.at(0) ?? ""] : selected}
            multiple={property.single !== true}
            onSelect={(value) => {
              if (property.single) {
                setFilter(property.key, value ? [value] : [])
                return setPage(undefined)
              }
              setFilter(
                property.key,
                selected.includes(value) ? selected.filter((each) => each !== value) : [...selected, value],
              )
            }}
          />
        </>
      ) : (
        <DisplayPage
          display={props.display}
          properties={props.properties}
          onChange={props.onChange}
          onOpen={setPage}
          onDone={close}
        />
      )}
    </Sheet>
  )
}

export { filterProperties, isFiltered, TaskDisplaySheet, TaskFilterChips }
