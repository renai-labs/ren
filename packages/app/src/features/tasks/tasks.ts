export * as Tasks from "./tasks.js"

import type { LabelSummary, TaskCreateInput, TaskInfo, TaskPage } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import type { Task } from "@ren/schema/task"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Struct } from "effect"
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import { Auth } from "../../lib/auth.js"
import { Keyboard } from "../../platform/keyboard.js"
import { RouterContext } from "../../lib/router-context.js"
import { TaskSearch } from "./task-search.js"

export type Patch = Partial<Pick<TaskInfo, "title" | "description" | "status" | "priority" | "dueAt" | "labels">>
export type Assignment = { readonly agentId?: string | null; readonly ownerId?: string | null }
export type BulkOperation =
  | { readonly kind: "status"; readonly status: Task.Status }
  | { readonly kind: "move"; readonly agentId: string | null }
  | { readonly kind: "archive" }

export interface Agent {
  readonly id: string
  readonly name: string
  readonly isGlobal: boolean
}

export interface Person {
  readonly id: string
  readonly name: string
  readonly image: string | undefined
}

const page = { page: 1, pageSize: Pagination.maximumPageSize }

const overlays = "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]"

const isBareKey = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.repeat && !event.isComposing

const isOnPage = (event: KeyboardEvent) =>
  !event.defaultPrevented &&
  !Keyboard.isTyping(event) &&
  !(event.target instanceof Element && event.target.closest(overlays))

export function useCreateHotkey(onCreate: () => void, options: { readonly enabled: boolean }) {
  Keyboard.useKeyDown((event) => {
    if (!options.enabled || event.key.toLowerCase() !== "c" || !isBareKey(event) || !isOnPage(event)) return
    event.preventDefault()
    onCreate()
  })
}

export const describe = (error: unknown) => (error instanceof Error ? error.message : "Try again.")

export const catalogOptions = TaskSearch.catalogOptions

export function useCatalog(organizationId: string) {
  const context = RouterContext.useRouterContext()
  const options = TaskSearch.catalogOptions(context.api)
  const spaces = useQuery(options[0]).data?.items ?? []
  const agents = (useQuery(options[1]).data?.items ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    isGlobal: agent.organizationId === null,
  }))
  const labels = useQuery(options[2]).data?.items ?? []
  const people = (useQuery(Auth.organizationOptions(context.auth, organizationId)).data?.members ?? []).map(
    (member) => ({
      id: member.userId,
      name: member.user.name || member.user.email,
      image: member.user.image ?? undefined,
    }),
  )
  return {
    spaces,
    agents,
    labels,
    people,
    agentName: (id: string) => agents.find((agent) => agent.id === id)?.name,
    person: (id: string) => people.find((person) => person.id === id),
  }
}

export function useSpaceAgents(spaceId: string | undefined, options: { readonly enabled: boolean }) {
  const context = RouterContext.useRouterContext()
  return useQuery({
    ...context.api.agent.list.queryOptions({ ...page, isSubagent: false, ...(spaceId && { spaceId }) }),
    enabled: options.enabled,
  })
}

export function useSpaceOwners(spaceId: string, options: { readonly enabled: boolean }) {
  const context = RouterContext.useRouterContext()
  return useQuery({
    ...context.api["space-member"].list.queryOptions({ ...page, spaceId }),
    enabled: options.enabled && spaceId !== "",
    select: (result) =>
      result.items.flatMap((member) =>
        member.status === "active"
          ? [{ id: member.userId, name: member.name || member.email, image: member.image ?? undefined }]
          : [],
      ),
  })
}

export function useLabels(options: { readonly enabled: boolean }) {
  const context = RouterContext.useRouterContext()
  return useQuery({ ...context.api.label.list.queryOptions(page), enabled: options.enabled })
}

export function useCreateLabel() {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  return useMutation({
    ...context.api.label.create.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: context.api.label.list.queryKey() }),
  })
}

type Snapshot = ReadonlyArray<readonly [QueryKey, unknown]>

async function patchLists(queryClient: QueryClient, key: QueryKey, id: string, patch: Partial<TaskInfo> | null) {
  await queryClient.cancelQueries({ queryKey: key })
  const snapshot: Snapshot = queryClient.getQueriesData({ queryKey: key })
  queryClient.setQueriesData<TaskPage>({ queryKey: key }, (data) =>
    data
      ? {
          ...data,
          items: patch
            ? data.items.map((task) => (task.id === id ? { ...task, ...patch } : task))
            : data.items.filter((task) => task.id !== id),
        }
      : data,
  )
  return snapshot
}

const labelNames = (labels: ReadonlyArray<LabelSummary>) => labels.map((label) => label.name)

const settle = <A>(items: ReadonlyArray<A>, run: (item: A) => Promise<unknown>) =>
  Array.from({ length: Math.ceil(items.length / 6) }, (_, index) => items.slice(index * 6, index * 6 + 6)).reduce<
    Promise<PromiseSettledResult<unknown>[]>
  >(async (done, chunk) => [...(await done), ...(await Promise.allSettled(chunk.map(run)))], Promise.resolve([]))

const plural = (count: number) => `${count} ${count === 1 ? "task" : "tasks"}`

export function useTaskActions() {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const lists = context.api.task.list.queryKey()
  const updateTask = useMutation(context.api.task.update.mutationOptions())
  const assignTask = useMutation(context.api.task.assign.mutationOptions())
  const createTask = useMutation(context.api.task.create.mutationOptions())
  const archiveTask = useMutation(context.api.task.archive.mutationOptions())
  const refresh = (options: { readonly labels: boolean }) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: lists }),
      queryClient.invalidateQueries({ queryKey: context.api.task.get.queryKey() }),
      ...(options.labels ? [queryClient.invalidateQueries({ queryKey: context.api.label.list.queryKey() })] : []),
    ])
  const optimistic = async (
    id: string,
    patch: Partial<TaskInfo> | null,
    run: () => Promise<unknown>,
    failure: { readonly title: string; readonly labels: boolean },
  ) => {
    const snapshot = await patchLists(queryClient, lists, id, patch)
    await run().then(
      () => refresh({ labels: failure.labels }),
      (error: unknown) => {
        for (const entry of snapshot) queryClient.setQueryData(entry[0], entry[1])
        Toast.manager.add({ type: "error", title: failure.title, description: describe(error) })
        return refresh({ labels: failure.labels })
      },
    )
  }
  const update = (task: TaskInfo, patch: Patch) =>
    optimistic(
      task.id,
      patch,
      () =>
        updateTask.mutateAsync({
          id: task.id,
          ...Struct.omit(patch, ["labels"]),
          ...(patch.labels && { labels: labelNames(patch.labels) }),
        }),
      { title: "Couldn’t update task", labels: patch.labels !== undefined },
    )
  const assign = (task: TaskInfo, assignment: Assignment) =>
    optimistic(task.id, assignment, () => assignTask.mutateAsync({ id: task.id, ...assignment, start: "none" }), {
      title: "Couldn’t assign task",
      labels: false,
    })
  const create = async (input: TaskCreateInput) => {
    const task = await createTask.mutateAsync(input)
    await refresh({ labels: (input.labels?.length ?? 0) > 0 })
    return task
  }
  const archive = async (task: TaskInfo) => {
    await archiveTask.mutateAsync({ id: task.id })
    await patchLists(queryClient, lists, task.id, null)
    await refresh({ labels: false })
  }
  const bulk = async (tasks: ReadonlyArray<TaskInfo>, operation: BulkOperation) => {
    const targets = tasks.filter((task) => {
      if (operation.kind === "status") return task.status !== operation.status
      if (operation.kind === "move") return task.agentId !== operation.agentId
      return true
    })
    const results = await settle(targets, (task) => {
      if (operation.kind === "status") return updateTask.mutateAsync({ id: task.id, status: operation.status })
      if (operation.kind === "move")
        return assignTask.mutateAsync({ id: task.id, agentId: operation.agentId, start: "none" })
      return archiveTask.mutateAsync({ id: task.id })
    })
    await refresh({ labels: false })
    const failed = targets.filter((_task, index) => results[index]?.status === "rejected")
    const reason = results.find((result) => result.status === "rejected")
    const verb = { status: "Updated", move: "Moved", archive: "Archived" }[operation.kind]
    if (failed.length === 0) Toast.manager.add({ type: "success", title: `${verb} ${plural(targets.length)}` })
    else
      Toast.manager.add({
        type: "error",
        title: `${verb} ${targets.length - failed.length} of ${plural(targets.length)}`,
        description: `${failed.length} failed and ${failed.length === 1 ? "remains" : "remain"} selected. ${describe(
          reason?.status === "rejected" ? reason.reason : undefined,
        )}`,
      })
    return failed
  }
  return { update, assign, create, archive, bulk, isCreating: createTask.isPending }
}
