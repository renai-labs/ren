import { useState } from "react"
import type { TaskInfo } from "@ren/client"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { toast } from "sonner"
import type { Filters } from "@/components/ren/filter-menu"
import { matchesFilters, type TaskLookups } from "@/components/ren/task-filters"
import { useAgents } from "@/hooks/use-agents"
import { useLabels } from "@/hooks/use-labels"
import { useMembers } from "@/hooks/use-members"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage } from "@/lib/api"
import { allTasksOptions, taskListInput } from "@/lib/tasks"
import { useTaskDisplay } from "@/stores/ui"

const route = getRouteApi("/_authed/_shell/tasks")

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }

export function useTasksPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tasks = useQuery({ ...allTasksOptions(taskListInput(search)), placeholderData: keepPreviousData })
  const display = useTaskDisplay()
  const spaces = useSpaces()
  const agents = useAgents()
  const members = useMembers()
  const labels = useLabels()
  const lookups: TaskLookups = {
    spaces: spaces.spaces,
    agents: agents.agents,
    members: members.members,
    labels,
  }
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [archiving, setArchiving] = useState(false)
  const update = useMutation(api.task.update.mutationOptions())
  const assign = useMutation(api.task.assign.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const filters: Filters = Object.fromEntries(
    Object.entries(search.filters ?? {}).map(([key, values]) => [key, [...values]]),
  )
  const needle = query.trim().toLowerCase()
  const roots: ReadonlyArray<TaskInfo> = tasks.data?.items ?? []
  const order = (a: TaskInfo, b: TaskInfo) => {
    const value =
      display.orderBy === "priority"
        ? (priorityRank[a.priority ?? ""] ?? 3) - (priorityRank[b.priority ?? ""] ?? 3)
        : Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return display.direction === "asc" ? value : -value
  }
  const visible = roots
    .filter((task) => matchesFilters(lookups, task, filters))
    .filter((task) => !needle || `${task.identifier} ${task.title}`.toLowerCase().includes(needle))
    .toSorted(order)
  const bulk = async (ids: ReadonlyArray<string>, run: (id: string) => Promise<unknown>, done: string) => {
    const results = await Promise.allSettled(ids.map(run))
    const failed = results.filter((result) => result.status === "rejected").length
    if (failed > 0) toast.error(`${failed} of ${ids.length} tasks couldn’t be changed`)
    else toast.success(done)
  }
  return {
    loading: tasks.isPending,
    stale: tasks.isPlaceholderData,
    roots,
    visible,
    idWidth: Math.max(0, ...roots.map((task) => task.identifier.length)) + 1,
    tasks: roots,
    lookups,
    display,
    filters,
    query,
    setQuery,
    setFilters: (next: Filters) =>
      void navigate({
        search: (previous) => ({
          ...previous,
          filters: Object.values(next).some((values) => values.length > 0) ? next : undefined,
        }),
      }),
    clearFilters: () => {
      setQuery("")
      void navigate({ search: (previous) => ({ ...previous, filters: undefined }) })
    },
    agentName: (agentId: string | null) => agents.agent(agentId)?.name ?? null,
    member: members.member,
    selected,
    setSelected,
    archiving,
    setArchiving,
    setStatus: (status: string) => {
      const ids = selected
      setSelected([])
      if (status !== "todo" && status !== "in_progress" && status !== "done" && status !== "dismissed") return
      void bulk(ids, (id) => update.mutateAsync({ id, status }), "Status changed")
    },
    move: (agentId: string | null) => {
      const ids = selected
      setSelected([])
      void bulk(ids, (id) => assign.mutateAsync({ id, agentId, start: "none" }), "Tasks moved")
    },
    archiveSelected: async () => {
      const ids = selected
      setSelected([])
      await bulk(
        ids,
        (id) => archive.mutateAsync({ id }),
        ids.length === 1 ? "Task archived" : `${ids.length} tasks archived`,
      )
    },
    errorMessage,
  }
}
