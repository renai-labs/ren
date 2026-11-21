import type { TaskInfo } from "@ren/client"
import { Tasks } from "@ren/client/react"
import { Task } from "@ren/schema/task"
import { FilterMatch } from "@ren/util/filter-match"
import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import IconX from "@tabler/icons-react-native/IconX"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { Stack, useRouter } from "expo-router"
import { useDeferredValue, useState, type ReactNode } from "react"
import { ActivityIndicator, Pressable, SectionList, View } from "react-native"
import AdjustmentsHorizontalIcon from "react-native-heroicons/mini/AdjustmentsHorizontalIcon"
import ArchiveBoxIcon from "react-native-heroicons/mini/ArchiveBoxIcon"
import ArrowTopRightOnSquareIcon from "react-native-heroicons/mini/ArrowTopRightOnSquareIcon"
import CheckCircleIcon from "react-native-heroicons/mini/CheckCircleIcon"
import ChevronDownIcon from "react-native-heroicons/mini/ChevronDownIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import CubeIcon from "react-native-heroicons/mini/CubeIcon"
import MagnifyingGlassIcon from "react-native-heroicons/mini/MagnifyingGlassIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import XCircleIcon from "react-native-heroicons/mini/XCircleIcon"
import { HeaderActions, HeaderButton } from "#components/header-button"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { SearchField } from "#components/search-field"
import { Text } from "#components/text"
import { FilterChips, isFiltered } from "#components/filters"
import { filterProperties, TaskDisplaySheet } from "#features/tasks/task-filters"
import {
  displayPreference,
  failed,
  isStatus,
  StatusGlyph,
  statusOptions,
  useTaskLookups,
  type Display,
  type TaskLookups,
} from "#features/tasks/task-meta"
import { NewTask } from "#features/tasks/task-new"
import { MenuSheet } from "#components/menu-sheet"
import { OptionSheet } from "#components/option-sheet"
import { TaskRow } from "#features/tasks/task-row"
import { Api } from "#lib/api"
import { Preferences } from "#lib/preferences"

interface Group {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly has: (task: TaskInfo) => boolean
}

const groupIcon = "size-4 text-muted-foreground"

const groupsFor = (lookups: TaskLookups): Record<Display["groupBy"], ReadonlyArray<Group>> => ({
  status: Task.Status.literals.map((status) => ({
    id: status,
    label: Task.statusLabels[status],
    icon: <StatusGlyph status={status} />,
    has: (task) => task.status === status,
  })),
  space: lookups.spaces.map((space) => ({
    id: space.id,
    label: space.name,
    icon: <Icon as={CubeIcon} className={groupIcon} />,
    has: (task) => task.spaceId === space.id,
  })),
  agent: [
    ...lookups.agents.map((agent) => ({
      id: agent.id,
      label: agent.name,
      icon: <Icon as={IconGhostFilled} className={groupIcon} />,
      has: (task: TaskInfo) => task.agentId === agent.id,
    })),
    {
      id: "none",
      label: "No agent",
      icon: <Icon as={IconGhostFilled} className={groupIcon} />,
      has: (task) => !task.agentId,
    },
  ],
})

function Empty(props: { readonly message: string; readonly action: string; readonly onPress: () => void }) {
  return (
    <View className="items-center gap-3 p-6 pt-16">
      <Text className="text-center text-muted-foreground">{props.message}</Text>
      <Button variant="outline" onPress={props.onPress}>
        <Text>{props.action}</Text>
      </Button>
    </View>
  )
}

function TaskHeaderActions(props: {
  readonly searching: boolean
  readonly filtered: boolean
  readonly onSearch: () => void
  readonly onDisplay: () => void
  readonly onNew: () => void
}) {
  return (
    <HeaderActions>
      <HeaderButton
        label={props.searching ? "Close search" : "Search tasks"}
        icon={props.searching ? IconX : MagnifyingGlassIcon}
        onPress={props.onSearch}
      />
      <HeaderButton
        label={props.filtered ? "Filter and display, filters on" : "Filter and display"}
        icon={AdjustmentsHorizontalIcon}
        dot={props.filtered}
        onPress={props.onDisplay}
      />
      <HeaderButton label="New task" icon={PlusIcon} onPress={props.onNew} />
    </HeaderActions>
  )
}

function TasksEmpty(props: {
  readonly filtered: boolean
  readonly loaded: number
  readonly onClear: () => void
  readonly onNew: () => void
}) {
  if (props.filtered || props.loaded > 0)
    return <Empty message="No tasks match these filters" action="Clear filters" onPress={props.onClear} />
  return <Empty message="No tasks yet" action="New task" onPress={props.onNew} />
}

function Pending(props: { readonly paused: boolean }) {
  if (props.paused)
    return (
      <Text className="p-6 text-center text-muted-foreground">You’re offline. Your tasks load when you reconnect.</Text>
    )
  return <ActivityIndicator className="mt-8" />
}

function GroupHeader(props: {
  readonly label: string
  readonly icon: ReactNode
  readonly count: number
  readonly collapsed: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role="button"
      aria-expanded={!props.collapsed}
      aria-label={`${props.label}, ${props.count} tasks`}
      className="mb-2 h-10 flex-row items-center gap-2 bg-background px-4"
      onPress={props.onPress}
    >
      <Icon as={props.collapsed ? ChevronRightIcon : ChevronDownIcon} className="size-4 text-muted-foreground" />
      {props.icon}
      <Text className="shrink font-medium" numberOfLines={1}>
        {props.label}
      </Text>
      <Text className="text-sm text-muted-foreground tabular-nums">{props.count}</Text>
    </Pressable>
  )
}

function TaskActions(props: {
  readonly task: TaskInfo | undefined
  readonly onOpen: (task: TaskInfo) => void
  readonly onStatus: (task: TaskInfo, status: Task.Status) => void
  readonly onArchive: (task: TaskInfo) => void
  readonly onClose: () => void
}) {
  const task = props.task
  return (
    <MenuSheet
      open={Boolean(task)}
      title={task ? `${task.identifier} · ${task.title}` : ""}
      onClose={props.onClose}
      items={
        task
          ? [
              { label: "Open", icon: ArrowTopRightOnSquareIcon, onPress: () => props.onOpen(task) },
              { label: "Mark done", icon: CheckCircleIcon, onPress: () => props.onStatus(task, "done") },
              { label: "Dismiss", icon: XCircleIcon, onPress: () => props.onStatus(task, "dismissed") },
              {
                label: "Archive",
                icon: ArchiveBoxIcon,
                onPress: () => props.onArchive(task),
                confirm: {
                  title: "Archive this task?",
                  description: "It leaves the task list. Its chats stay.",
                  action: "Archive",
                },
              },
            ]
          : []
      }
    />
  )
}

export default function TasksScreen() {
  const router = useRouter()
  const [display, setDisplay] = Preferences.usePreference(displayPreference)
  const filters = display.filters
  const tasks = useQuery({
    ...Tasks.all(Api.client, Tasks.listInput(filters)),
    placeholderData: keepPreviousData,
  })
  const update = useMutation(Api.query.task.update.mutationOptions())
  const archive = useMutation(Api.query.task.archive.mutationOptions())
  const pending = update.isPending ? update.variables : undefined
  const roots = (tasks.data?.items ?? []).map((task) =>
    task.id === pending?.id ? Tasks.withPatch(task, pending) : task,
  )
  const lookups = useTaskLookups(roots.map((task) => task.spaceId))
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const needle = useDeferredValue(query.trim().toLowerCase())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(["status:done", "status:dismissed"]))
  const [open, setOpen] = useState<"display" | "new">()
  const [statusFor, setStatusFor] = useState<TaskInfo>()
  const [menuFor, setMenuFor] = useState<TaskInfo>()
  const [pulling, setPulling] = useState(false)
  const properties = filterProperties(lookups)
  const filtered = isFiltered(filters) || needle !== ""

  const visible = roots
    .filter((task) => FilterMatch.passes(filters, Tasks.filterValues(task)))
    .filter((task) => !needle || `${task.identifier} ${task.title}`.toLowerCase().includes(needle))
    .toSorted(Tasks.order(display))
  const sections = groupsFor(lookups)
    [display.groupBy].map((group) => {
      const key = `${display.groupBy}:${group.id}`
      const members = visible.filter(group.has)
      return { key, group, count: members.length, data: collapsed.has(key) ? [] : members }
    })
    .filter((section) => display.showEmpty || section.count > 0)

  const change = (task: TaskInfo, status: Task.Status) =>
    update.mutate({ id: task.id, status }, { onError: failed("Couldn’t save the task") })
  const openTask = (task: { readonly id: string }) => router.push({ pathname: "/tasks/[id]", params: { id: task.id } })
  const clear = () => {
    setQuery("")
    setDisplay({ ...display, filters: {} })
  }
  const refresh = async () => {
    setPulling(true)
    await tasks.refetch()
    setPulling(false)
  }
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerRight: () => (
            <TaskHeaderActions
              searching={searching}
              filtered={isFiltered(filters)}
              onSearch={() => {
                if (searching) setQuery("")
                setSearching(!searching)
              }}
              onDisplay={() => setOpen("display")}
              onNew={() => setOpen("new")}
            />
          ),
        }}
      />
      {searching ? (
        <View className="px-4 pb-2">
          <SearchField
            value={query}
            label="Search tasks"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the person asked to search
            autoFocus
            onChange={setQuery}
          />
        </View>
      ) : null}
      <FilterChips
        properties={properties}
        filters={filters}
        onChange={(next) => setDisplay({ ...display, filters: next })}
      />
      {tasks.isPending ? <Pending paused={tasks.fetchStatus === "paused"} /> : null}
      {tasks.isError ? (
        <Empty message="Couldn’t load your tasks." action="Try again" onPress={() => void tasks.refetch()} />
      ) : null}
      {tasks.isSuccess ? (
        <SectionList
          sections={sections}
          keyExtractor={(task) => task.id}
          className={cn(tasks.isPlaceholderData && "opacity-60")}
          stickySectionHeadersEnabled
          keyboardDismissMode="on-drag"
          refreshing={pulling}
          onRefresh={() => void refresh()}
          contentContainerClassName="pb-safe-offset-6"
          // ast-grep-ignore: no-render-props -- the list hands back the section whose header it renders
          renderSectionHeader={(header) => (
            <GroupHeader
              label={header.section.group.label}
              icon={header.section.group.icon}
              count={header.section.count}
              collapsed={collapsed.has(header.section.key)}
              onPress={() => toggle(header.section.key)}
            />
          )}
          renderItem={(row) => (
            <TaskRow
              task={row.item}
              spaceName={display.groupBy === "space" ? undefined : lookups.spaceName(row.item.spaceId)}
              owner={lookups.member(row.item.ownerId)}
              onPress={() => openTask(row.item)}
              onLongPress={() => setMenuFor(row.item)}
              onStatus={() => setStatusFor(row.item)}
            />
          )}
          ListEmptyComponent={
            <TasksEmpty filtered={filtered} loaded={roots.length} onClear={clear} onNew={() => setOpen("new")} />
          }
        />
      ) : null}
      {statusFor ? (
        <OptionSheet
          open
          title={`Status for ${statusFor.identifier}`}
          options={statusOptions}
          selected={[statusFor.status]}
          onSelect={(status) => {
            if (isStatus(status)) change(statusFor, status)
          }}
          onClose={() => setStatusFor(undefined)}
        />
      ) : null}
      <TaskActions
        task={menuFor}
        onOpen={openTask}
        onStatus={change}
        onArchive={(task) => archive.mutate({ id: task.id }, { onError: failed("Couldn’t archive the task") })}
        onClose={() => setMenuFor(undefined)}
      />
      <TaskDisplaySheet
        open={open === "display"}
        display={display}
        properties={properties}
        onChange={setDisplay}
        onClose={() => setOpen(undefined)}
      />
      <NewTask open={open === "new"} onClose={() => setOpen(undefined)} onCreated={openTask} />
    </View>
  )
}
