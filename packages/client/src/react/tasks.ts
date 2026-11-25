export * as Tasks from "./tasks.js"

import { Search } from "@ren/schema/search"
import { queryOptions } from "@tanstack/react-query"
import { Struct } from "effect"
import type {
  Ren,
  TaskActivityInfo,
  TaskCreateInput,
  TaskInfo,
  TaskListInput,
  TaskUpdateInput,
} from "../generated/index.js"

type Client = ReturnType<typeof Ren.make>

export type Filter = Omit<TaskListInput, "page" | "pageSize">

export type Filters = Readonly<Record<string, ReadonlyArray<string>>>

const pageSize = 100

export const refreshEvery = 5000

export const working = (task: Pick<TaskInfo, "session">) => task.session?.state === "working"

// oxlint-disable-next-line ren/no-comments -- Tasks change on their own only while an agent works on one, so only then is it worth polling; otherwise a list refreshes when it mounts stale, on window focus and after any task mutation.
export const pollWhileWorking = (tasks: ReadonlyArray<Pick<TaskInfo, "session">> | undefined) =>
  tasks?.some(working) ? refreshEvery : false

const statuses = ["backlog", "todo", "in_progress", "done", "dismissed"] as const satisfies ReadonlyArray<
  TaskInfo["status"]
>

const isStatus = (value: string | undefined): value is TaskInfo["status"] => statuses.some((status) => status === value)

const openStatuses: ReadonlyArray<TaskInfo["status"]> = ["backlog", "todo", "in_progress"]

const isOpen = (value: string | undefined) => openStatuses.some((status) => status === value)

const isPriority = (value: string | undefined): value is NonNullable<TaskInfo["priority"]> =>
  value === "high" || value === "medium" || value === "low"

const one = (values: ReadonlyArray<string> | undefined) => (values?.length === 1 ? values.at(0) : undefined)

const person = (value: string | undefined) => (value === "none" || value === "me" ? undefined : value)

export function listInput(given: Filters | undefined, space?: string): Filter {
  const filters = given ?? {}
  const status = one(filters.status)
  const priority = one(filters.priority)
  const spaceId = space ?? one(filters.space)
  const agentId = person(one(filters.agent))
  const ownerId = person(one(filters.owner))
  const label = one(filters.label)
  const open = isOpen(status)
  return {
    parentId: "none",
    ...(open ? {} : { includeDone: true }),
    ...(isStatus(status) && { status }),
    ...(isPriority(priority) && { priority }),
    ...(spaceId && { spaceId }),
    ...(agentId && { agentId }),
    ...(ownerId && { ownerId }),
    ...(label && { label }),
  }
}

export const searchInput = (input: Filter, search: string): Filter =>
  search ? { ...Struct.omit(input, ["parentId"]), search } : input

export const filterValues = (task: TaskInfo, userId?: string): Record<string, ReadonlyArray<string>> => ({
  space: [task.spaceId],
  status: [task.status],
  priority: [task.priority ?? "none"],
  agent: [task.agentId ?? "none"],
  owner: [task.ownerId ?? "none", ...(userId && task.ownerId === userId ? ["me"] : [])],
  label: task.labels.map((label) => label.name),
  review: task.humanReview ? ["needed"] : [],
})

const priorityRank: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 }

export const order =
  (display: { readonly orderBy: string; readonly direction: string }) => (a: TaskInfo, b: TaskInfo) => {
    const value =
      display.orderBy === "priority"
        ? (priorityRank[a.priority ?? ""] ?? 3) - (priorityRank[b.priority ?? ""] ?? 3)
        : Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return display.direction === "asc" ? value : -value
  }

const wordRank = (task: TaskInfo, word: string) => {
  const identifier = task.identifier.toLowerCase()
  if (word === identifier || word.replace(/^#/u, "") === String(task.number)) return 0
  const title = task.title.toLowerCase()
  if (title.split(/[^\p{L}\p{N}]+/u).some((part) => part.startsWith(word))) return 1
  if (title.includes(word) || (!/^[a-z][a-z0-9]*-\d+$/u.test(word) && identifier.startsWith(word))) return 2
  if (
    task.description?.toLowerCase().includes(word) ||
    task.labels.some((label) => label.name.toLowerCase().includes(word))
  )
    return 3
  return 4
}

export const treeInput = (input: Filter): Filter => Struct.omit(input, ["parentId"])

export type Branch = "middle" | "last"

export const nest = <A extends { readonly id: string; readonly parentId: string | null }>(
  tops: ReadonlyArray<A>,
  all: ReadonlyArray<A>,
) => {
  const children = new Map<string, A[]>()
  for (const task of all) {
    if (!task.parentId) continue
    const siblings = children.get(task.parentId) ?? []
    siblings.push(task)
    children.set(task.parentId, siblings)
  }
  const rows: Array<{ task: A; branch: Branch | undefined }> = []
  for (const task of tops) {
    rows.push({ task, branch: undefined })
    const nested = children.get(task.id) ?? []
    for (const [index, child] of nested.entries())
      rows.push({ task: child, branch: index === nested.length - 1 ? "last" : "middle" })
  }
  return rows
}

export const tops = <A extends { readonly id: string; readonly parentId: string | null }>(all: ReadonlyArray<A>) => {
  const ids = new Set(all.map((task) => task.id))
  return all.filter((task) => !task.parentId || !ids.has(task.parentId))
}

export const search = (tasks: ReadonlyArray<TaskInfo>, text: string, order: (a: TaskInfo, b: TaskInfo) => number) =>
  tasks
    .map((task) => ({ task, rank: Math.max(0, ...Search.words(text).map((word) => wordRank(task, word))) }))
    .toSorted((a, b) => a.rank - b.rank || order(a.task, b.task))
    .map((match) => match.task)

export type Patch = Omit<TaskUpdateInput, "id">

export const withPatch = (task: TaskInfo, patch: Patch | undefined): TaskInfo =>
  patch
    ? {
        ...task,
        ...(patch.title && { title: patch.title }),
        ...(patch.status && { status: patch.status }),
        // ast-grep-ignore: no-nullish-comparison, -- null clears the priority; undefined leaves it
        ...(patch.priority !== undefined && { priority: patch.priority }),
        // ast-grep-ignore: no-nullish-comparison, -- null clears the due date; undefined leaves it
        ...(patch.dueAt !== undefined && { dueAt: patch.dueAt }),
      }
    : task

export const draft = (spaceId: string) => ({
  spaceId,
  title: "",
  description: "",
  status: "todo",
  priority: "none",
  agentId: "none",
  ownerId: "none",
  labels: [] as ReadonlyArray<string>,
  dueAt: "",
})

export type Draft = ReturnType<typeof draft>

export const createInput = (form: Draft, spaceId: string, parentId?: string): TaskCreateInput => ({
  spaceId,
  ...(parentId && { parentId }),
  ...(form.dueAt && { dueAt: form.dueAt }),
  title: form.title.trim(),
  ...(form.description.trim() && { description: form.description.trim() }),
  status: isStatus(form.status) ? form.status : "todo",
  ...(isPriority(form.priority) && { priority: form.priority }),
  ...(form.agentId !== "none" && { agentId: form.agentId }),
  ...(form.ownerId !== "none" && { ownerId: form.ownerId }),
  ...(form.labels.length > 0 && { labels: form.labels }),
})

export const subtasksInput = (parentId: string): TaskListInput => ({ parentId, includeDone: true, page: 1, pageSize })

export const allKey = (input?: Filter) => (input ? (["task", "all", input] as const) : (["task", "all"] as const))

export const all = (client: Client, input: Filter) =>
  queryOptions({
    queryKey: allKey(input),
    queryFn: async (context) => {
      const first = await client.task.list({ ...input, page: 1, pageSize }, { signal: context.signal })
      const pages = first.items.length === 0 ? 1 : Math.ceil(first.total / first.pageSize)
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
          client.task.list({ ...input, page: index + 2, pageSize }, { signal: context.signal }),
        ),
      )
      return { items: [first, ...rest].flatMap((result) => result.items), total: first.total }
    },
    refetchInterval: (query) => pollWhileWorking(query.state.data?.items),
  })

export const activity = (client: Client, taskId: string) =>
  queryOptions({
    queryKey: ["task-activity", "all", taskId] as const,
    queryFn: async (context) => {
      const items: TaskActivityInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- pages fetched in order until total reached
        const result = await client["task-activity"].list({ taskId, page, pageSize }, { signal: context.signal })
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
  })
