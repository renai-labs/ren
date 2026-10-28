export * as Tasks from "./tasks.js"

import type { AgentInfo, LabelSummary, TaskCreateInput, TaskInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import type { Task } from "@ren/schema/task"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Struct } from "effect"
import { Auth } from "../../lib/auth.js"
import { Pages } from "../../lib/pages.js"
import { Keyboard } from "../../platform/keyboard.js"
import { RouterContext } from "../../lib/router-context.js"
import { TaskQueries } from "./task-queries.js"

export type Patch = Partial<
  Pick<TaskInfo, "title" | "description" | "status" | "priority" | "dueAt" | "labels" | "parentId">
>
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

const toAgent = (agent: AgentInfo): Agent => ({
  id: agent.id,
  name: agent.name,
  isGlobal: agent.organizationId === null,
})

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

export function useCatalog(organizationId: string) {
  const context = RouterContext.useRouterContext()
  const options = TaskQueries.catalogOptions(context.api)
  const spaceList = useQuery(options[0])
  const spaces = spaceList.data?.items ?? []
  const agents = (useQuery(options[1]).data?.items ?? []).map(toAgent)
  const labels = useQuery(options[2]).data?.items ?? []
  const people = (useQuery(Auth.organizationOptions(context.auth, organizationId)).data?.members ?? []).map(
    (member) => ({
      id: member.userId,
      name: member.user.name || member.user.email,
      image: member.user.image ?? undefined,
    }),
  )
  return {
    pending: spaceList.isPending,
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
    ...Pages.all((number) =>
      context.api.agent.list.queryOptions({ ...page, page: number, isSubagent: false, ...(spaceId && { spaceId }) }),
    ),
    enabled: options.enabled,
    select: (result) => result.items.map(toAgent),
  })
}

export function useSpaceOwners(spaceId: string, options: { readonly enabled: boolean }) {
  const context = RouterContext.useRouterContext()
  return useQuery({
    ...Pages.all((number) => context.api["space-member"].list.queryOptions({ ...page, page: number, spaceId })),
    enabled: options.enabled && spaceId !== "",
    select: (result) =>
      result.items.flatMap((member) =>
        member.status === "active"
          ? [{ id: member.userId, name: member.name || member.email, image: member.image ?? undefined }]
          : [],
      ),
  })
}

export function useParentCandidates(task: TaskInfo, options: { readonly enabled: boolean }) {
  const context = RouterContext.useRouterContext()
  return useQuery({
    ...Pages.all((number) =>
      context.api.task.list.queryOptions({
        ...page,
        page: number,
        spaceId: task.spaceId,
        parentId: "none",
        includeDone: true,
      }),
    ),
    enabled: options.enabled,
    select: (result) => result.items.filter((candidate) => candidate.id !== task.id),
  })
}

export function useLabels(options: { readonly enabled: boolean; readonly spaceId?: string }) {
  const context = RouterContext.useRouterContext()
  return useQuery({
    ...Pages.all((number) =>
      context.api.label.list.queryOptions({
        ...page,
        page: number,
        ...(options.spaceId && { spaceId: options.spaceId }),
      }),
    ),
    enabled: options.enabled,
  })
}

export function useCreateLabel() {
  const context = RouterContext.useRouterContext()
  return useMutation(context.api.label.create.mutationOptions())
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
  const updating = useMutation(context.api.task.update.mutationOptions())
  const assigning = useMutation(context.api.task.assign.mutationOptions())
  const creating = useMutation(context.api.task.create.mutationOptions())
  const update = (task: Pick<TaskInfo, "id">, patch: Patch) =>
    updating.mutateAsync({
      id: task.id,
      ...Struct.omit(patch, ["labels"]),
      ...(patch.labels && { labels: labelNames(patch.labels) }),
    })
  const assign = (task: Pick<TaskInfo, "id">, assignment: Assignment) =>
    assigning.mutateAsync({ id: task.id, ...assignment, start: "none" })
  const create = (input: TaskCreateInput) => creating.mutateAsync(input)
  const bulk = async (tasks: ReadonlyArray<TaskInfo>, operation: BulkOperation) => {
    const targets = tasks.filter((task) => {
      if (operation.kind === "status") return task.status !== operation.status
      if (operation.kind === "move") return task.agentId !== operation.agentId
      return true
    })
    const results = await settle(targets, (task) => {
      if (operation.kind === "status") return context.client.task.update({ id: task.id, status: operation.status })
      if (operation.kind === "move")
        return context.client.task.assign({ id: task.id, agentId: operation.agentId, start: "none" })
      return context.client.task.archive({ id: task.id })
    })
    await Promise.all(
      [
        context.api.task.list.queryKey(),
        context.api.task.get.queryKey(),
        context.api["task-activity"].list.queryKey(),
      ].map((queryKey) =>
        // ast-grep-ignore: no-manual-invalidation -- bulk changes call context.client in batches, not a mutation
        queryClient.invalidateQueries({ queryKey }),
      ),
    )
    const failed = targets.filter((_task, index) => results[index]?.status === "rejected")
    const reason = results.find((result) => result.status === "rejected")
    const verb = { status: "Updated", move: "Moved", archive: "Archived" }[operation.kind]
    if (failed.length === 0) toast.add({ type: "success", title: `${verb} ${plural(targets.length)}` })
    else
      toast.add({
        type: "error",
        timeout: 0,
        title: `${verb} ${targets.length - failed.length} of ${plural(targets.length)}`,
        description: `${failed.length} failed and ${failed.length === 1 ? "remains" : "remain"} selected. ${describe(
          reason?.status === "rejected" ? reason.reason : undefined,
        )}`,
      })
    return failed
  }
  return { update, assign, create, bulk, isCreating: creating.isPending }
}
