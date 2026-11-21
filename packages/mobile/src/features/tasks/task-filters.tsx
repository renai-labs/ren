import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import { useState, type ReactNode } from "react"
import { ScrollView, Switch, View } from "react-native"
import ArrowDownIcon from "react-native-heroicons/mini/ArrowDownIcon"
import ArrowUpIcon from "react-native-heroicons/mini/ArrowUpIcon"
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
import { FilterOptions, FilterRows, type FilterProperty } from "#components/filters"
import { SheetTitle } from "#components/option-sheet"

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
        <FilterRows properties={props.properties} filters={display.filters} onOpen={props.onOpen} />
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
        <FilterOptions
          property={property}
          selected={selected}
          onChange={(values) => setFilter(property.key, values)}
          onBack={() => setPage(undefined)}
        />
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

export { filterProperties, TaskDisplaySheet }
