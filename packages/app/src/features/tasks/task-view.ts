export * as TaskView from "./task-view.js"

import type { LabelSummary, TaskInfo } from "@ren/client"
import type { Task } from "@ren/schema/task"
import type { StatusTone } from "@ren/ui/status-dot"
import { TaskLabel } from "@ren/ui/task-label"
import type { TaskTurnProps } from "@ren/ui/task-turn"
import { Search } from "@ren/util/search"
import { TaskSearch } from "./task-search.js"

export const none = "none"

export const filterProperties = ["status", "priority", "space", "agent", "owner", "label", "review"] as const
export type FilterProperty = (typeof filterProperties)[number]

export interface View {
  readonly layout: "list" | "board"
  readonly query: string
  readonly filters: TaskSearch.Filters
  readonly group: typeof TaskSearch.Group.Type
  readonly sort: typeof TaskSearch.Sort.Type
  readonly direction: typeof TaskSearch.Direction.Type
  readonly empty: boolean
  readonly subtasks: boolean
  readonly properties: ReadonlyArray<TaskSearch.Property>
  readonly boardProperties: ReadonlyArray<TaskSearch.Property>
  readonly selected: ReadonlyArray<string>
}

const defaultProperties: ReadonlyArray<TaskSearch.Property> = ["status", "priority", "owner", "labels"]
const defaultBoardProperties: ReadonlyArray<TaskSearch.Property> = [...defaultProperties, "created"]

export const resolve = (search: TaskSearch.SearchParams, saved: TaskSearch.Filters): View => ({
  layout: search.layout ?? "list",
  query: search.q ?? "",
  filters: search.filters ?? saved,
  group: search.group ?? "agent",
  sort: search.sort ?? "created",
  direction: search.direction ?? "desc",
  empty: search.empty ?? false,
  subtasks: search.subtasks ?? true,
  properties: search.properties ?? defaultProperties,
  boardProperties: search.boardProperties ?? defaultBoardProperties,
  selected: search.selected ?? [],
})

export const toSearch = (view: View): TaskSearch.SearchParams => ({
  ...(view.layout === "board" && { layout: view.layout }),
  ...(view.query && { q: view.query }),
  filters: view.filters,
  ...(view.group !== "agent" && { group: view.group }),
  ...(view.sort !== "created" && { sort: view.sort }),
  ...(view.direction !== "desc" && { direction: view.direction }),
  ...(view.empty && { empty: true }),
  ...(!view.subtasks && { subtasks: false }),
  ...(!sameValues(view.properties, defaultProperties) && { properties: view.properties }),
  ...(!sameValues(view.boardProperties, defaultBoardProperties) && { boardProperties: view.boardProperties }),
  ...(view.selected.length > 0 && { selected: view.selected }),
})

export const sameValues = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((value) => b.includes(value))

export const isDefaultFilter = (filters: TaskSearch.Filters, property: FilterProperty) =>
  sameValues(filters[property], TaskSearch.defaultFilters[property])

export const statuses: ReadonlyArray<Task.Status> = ["todo", "in_progress", "done", "dismissed"]

export const statusLabel: Record<Task.Status, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
}

export const priorities: ReadonlyArray<Task.Priority> = ["high", "medium", "low"]

export const priorityLabel = (priority: Task.Priority | null) =>
  priority ? { low: "Low", medium: "Medium", high: "High" }[priority] : "No priority"

const priorityRank = { high: 3, medium: 2, low: 1 }

const value = (task: TaskInfo, property: Exclude<FilterProperty, "label">) =>
  ({
    status: task.status,
    priority: task.priority ?? none,
    space: task.spaceId,
    agent: task.agentId ?? none,
    owner: task.ownerId ?? none,
    review: task.humanReview ? "on" : "off",
  })[property]

export function visible(tasks: ReadonlyArray<TaskInfo>, view: View) {
  const query = view.query.trim()
  const matches = (task: TaskInfo) =>
    (view.subtasks || task.parentId === null) &&
    (!query ||
      Search.matches(
        [task.identifier, task.title, task.description ?? "", ...task.labels.map((label) => label.name)],
        query,
      )) &&
    filterProperties.every((property) =>
      property === "label"
        ? view.filters.label.length === 0 || task.labels.some((label) => view.filters.label.includes(label.id))
        : view.filters[property].length === 0 || view.filters[property].includes(value(task, property)),
    )
  const order = (a: TaskInfo, b: TaskInfo) => {
    const sign = view.direction === "asc" ? 1 : -1
    if (view.sort === "priority" && a.priority !== b.priority) {
      if (!a.priority) return 1
      if (!b.priority) return -1
      return sign * (priorityRank[a.priority] - priorityRank[b.priority])
    }
    return sign * a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  }
  return tasks.filter(matches).toSorted(order)
}

export interface Entry {
  readonly task: TaskInfo
  readonly branch?: "middle" | "last"
  readonly parent?: string
}

export function tree(tasks: ReadonlyArray<TaskInfo>): ReadonlyArray<Entry> {
  const ids = new Set(tasks.map((task) => task.id))
  const nested = (task: TaskInfo) => task.parentId !== null && ids.has(task.parentId)
  const children = Map.groupBy(tasks.filter(nested), (task) => task.parentId)
  return tasks
    .filter((task) => !nested(task))
    .flatMap((task) => {
      const subtasks = children.get(task.id) ?? []
      const head: Entry = task.parent ? { task, parent: task.parent.title } : { task }
      return [
        [head],
        subtasks.map((subtask, index): Entry => ({
          task: subtask,
          branch: index === subtasks.length - 1 ? "last" : "middle",
        })),
      ]
    })
    .flat()
}

export interface Group {
  readonly id: string
  readonly name: string
  readonly agentId: string | null
  readonly status?: Task.Status
  readonly tasks: ReadonlyArray<TaskInfo>
}

export function boardGroups(
  space: { readonly id: string; readonly agentOrder: ReadonlyArray<string> },
  agents: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  tasks: ReadonlyArray<TaskInfo>,
): Group[] {
  const rows = tasks.filter((task) => task.spaceId === space.id)
  const names = new Map(agents.map((agent) => [agent.id, agent.name]))
  const extra = [...new Set(rows.flatMap((task) => task.agentId ?? []))]
    .filter((id) => !space.agentOrder.includes(id))
    .toSorted(
      (a, b) =>
        (names.get(a) ?? "Archived agent").localeCompare(names.get(b) ?? "Archived agent") || a.localeCompare(b),
    )
  return [
    { id: none, name: "No agent", agentId: null, tasks: rows.filter((task) => task.agentId === null) },
    ...[...space.agentOrder, ...extra].map((id) => ({
      id,
      name: names.get(id) ?? "Archived agent",
      agentId: id,
      tasks: rows.filter((task) => task.agentId === id),
    })),
  ]
}

function agentGroups(
  agents: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  tasks: ReadonlyArray<TaskInfo>,
  rows: ReadonlyArray<TaskInfo>,
  view: View,
): Group[] {
  const known = new Map(agents.map((agent) => [agent.id, agent.name]))
  const ids = [...new Set([...agents.map((agent) => agent.id), ...tasks.flatMap((task) => task.agentId ?? [])])]
  return [
    ...ids
      .map((id) => ({
        id,
        name: known.get(id) ?? "Archived agent",
        agentId: id,
        tasks: rows.filter((row) => row.agentId === id),
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    { id: none, name: "No agent", agentId: null, tasks: rows.filter((row) => row.agentId === null) },
  ].filter((group) => view.empty || group.tasks.length > 0)
}

function statusGroups(rows: ReadonlyArray<TaskInfo>): Group[] {
  return (["in_progress", "todo", "done", "dismissed"] as const)
    .map((status) => ({
      id: `status:${status}`,
      name: statusLabel[status],
      agentId: null,
      status,
      tasks: rows.filter((row) => row.status === status),
    }))
    .filter((group) => group.tasks.length > 0)
}

export interface FilterOption {
  readonly value: string
  readonly label: string
  readonly tone?: StatusTone
  readonly image?: string | undefined
}

export type FilterOptions = Record<FilterProperty, ReadonlyArray<FilterOption>>

export function filterOptions(input: {
  readonly tasks: ReadonlyArray<TaskInfo>
  readonly catalog: {
    readonly spaces: ReadonlyArray<{ readonly id: string; readonly name: string }>
    readonly agents: ReadonlyArray<{ readonly id: string; readonly name: string }>
    readonly people: ReadonlyArray<{ readonly id: string; readonly name: string; readonly image: string | undefined }>
    readonly labels: ReadonlyArray<LabelSummary>
  }
}): FilterOptions {
  const sorted = (entries: ReadonlyArray<FilterOption>) =>
    [...new Map(entries.map((entry) => [entry.value, entry])).values()].toSorted(
      (a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
    )
  const labels = [...input.tasks.flatMap((task) => task.labels), ...input.catalog.labels]
  return {
    status: statuses.map((status) => ({ value: status, label: statusLabel[status] })),
    priority: [
      { value: none, label: priorityLabel(null) },
      ...priorities.map((priority) => ({ value: priority, label: priorityLabel(priority) })),
    ],
    space: sorted(input.catalog.spaces.map((space) => ({ value: space.id, label: space.name }))),
    agent: [
      { value: none, label: "No agent" },
      ...sorted([
        ...input.tasks.flatMap((task) => (task.agentId ? [{ value: task.agentId, label: "Archived agent" }] : [])),
        ...input.catalog.agents.map((agent) => ({ value: agent.id, label: agent.name })),
      ]),
    ],
    owner: [
      { value: none, label: "No owner" },
      ...sorted([
        ...input.tasks.flatMap((task) => (task.ownerId ? [{ value: task.ownerId, label: "Former member" }] : [])),
        ...input.catalog.people.map((person) => ({ value: person.id, label: person.name, image: person.image })),
      ]),
    ],
    label: sorted(
      labels.map((label) => ({ value: label.id, label: TaskLabel.display(label.name), tone: TaskLabel.tone(label) })),
    ),
    review: [
      { value: "on", label: "Needs review" },
      { value: "off", label: "No review" },
    ],
  }
}

export const groups = (
  view: View,
  agents: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  tasks: ReadonlyArray<TaskInfo>,
  rows: ReadonlyArray<TaskInfo>,
) => (view.group === "status" ? statusGroups(rows) : agentGroups(agents, tasks, rows, view))

export const preferredSpace = (filters: TaskSearch.Filters) =>
  filters.space.length === 1 ? (filters.space[0] ?? "") : ""

export const isActionable = (task: TaskInfo) => task.status === "todo" || task.status === "in_progress"

export type CollectionState = "loading" | "no-spaces" | "failed" | "no-tasks" | "no-results" | "ready"

export const attentionOwner = (task: TaskInfo, userId: string, person: (id: string) => { name: string } | undefined) =>
  task.ownerId && task.ownerId !== userId ? person(task.ownerId)?.name : undefined

export function collectionState(input: {
  readonly status: "pending" | "error" | "success"
  readonly spaces: number
  readonly tasks: ReadonlyArray<TaskInfo>
  readonly rows: ReadonlyArray<TaskInfo>
}): CollectionState {
  if (input.status === "pending") return "loading"
  if (input.spaces === 0) return "no-spaces"
  if (input.status === "error") return "failed"
  if (input.rows.length > 0) return "ready"
  return input.tasks.length > 0 ? "no-results" : "no-tasks"
}

export function turn(
  task: TaskInfo,
  people: {
    readonly agent: (id: string) => string | undefined
    readonly owner: (id: string) => string | undefined
    readonly userId: string
  },
): TaskTurnProps {
  if (task.status === "done" || task.status === "dismissed") return { state: task.status }
  const owner = task.ownerId ? people.owner(task.ownerId) : undefined
  if (task.humanReview)
    return {
      state: "needs_you",
      name: task.ownerId === people.userId ? undefined : owner,
      reason: task.humanReviewReason ?? "",
    }
  if (task.agentId) {
    const name = people.agent(task.agentId) ?? "Archived agent"
    if (!task.session) return { state: "not_started", name }
    return { state: ({ working: "working", idle: "idle", failed: "stopped" } as const)[task.session.state], name }
  }
  if (task.status === "in_progress") return { state: "owner_working", name: owner }
  return { state: "not_started" }
}
