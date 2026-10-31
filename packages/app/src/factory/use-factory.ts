import { useEffect, useState } from "react"
import type { SpaceInfo } from "@ren/client"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { api, errorMessage } from "@/lib/api"
import { allTasksOptions } from "@/lib/tasks"
import { spaceAgentsOptions } from "@/routes/space/use-space"
import { SPEND_STAGES, buildAnalytics } from "./lib/analytics"
import { gridEnd, gridStart, realAnalytics, realWorld, stageOfAgent } from "./lib/real"
import { simulate } from "./lib/simulate"
import type { Resolution, WorkStage } from "./lib/types"

const STACK_KEY = "ren-factory:stacks:v1"

function readStored(key: string): unknown {
  try {
    // oxlint-disable-next-line no-restricted-properties -- callers validate the value
    return JSON.parse(window.localStorage.getItem(key) ?? "null")
  } catch {
    return undefined
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function loadStacks(): Record<string, boolean> {
  const stored = readStored(STACK_KEY)
  if (typeof stored !== "object" || !stored) return {}
  return Object.fromEntries(
    Object.entries(stored).flatMap(([stage, expanded]) => (typeof expanded === "boolean" ? [[stage, expanded]] : [])),
  )
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

const legacyZones: Readonly<Record<string, string>> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
}

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const timezone = legacyZones[browserZone] ?? browserZone

const mock = buildAnalytics(simulate(Date.now()))

export function useFactory(space: SpaceInfo) {
  const navigate = useNavigate()
  const now = useNow(60_000)
  const tasks = useQuery(allTasksOptions({ spaceId: space.id, parentId: "none" }))
  const agents = useQuery(spaceAgentsOptions(space.id))
  const names = new Map((agents.data?.items ?? []).map((agent) => [agent.id, agent.name]))
  const stages = new Map(
    space.factory.agents.map((entry, index) => [entry.agentId, stageOfAgent(names.get(entry.agentId) ?? "", index)]),
  )
  const namesOf = (stage: WorkStage) =>
    [...stages].flatMap((entry) => (entry[1] === stage ? [names.get(entry[0]) ?? ""] : [])).filter(Boolean)
  const from = gridStart(now)
  const range = {
    spaceId: space.id,
    from: new Date(from).toISOString(),
    to: new Date(gridEnd(now)).toISOString(),
    timezone,
    groupBy: "day" as const,
    orderBy: "cost" as const,
    limit: 50,
  }
  const total = useQuery({ ...api.insights.query.queryOptions(range), retry: false })
  const byStage = useQueries({
    queries: SPEND_STAGES.map((stage) => ({
      ...api.insights.query.queryOptions({ ...range, agent: namesOf(stage) }),
      enabled: agents.isSuccess && namesOf(stage).length > 0,
      retry: false,
    })),
  })
  const spend = Object.fromEntries(SPEND_STAGES.map((stage, index) => [stage, byStage[index]?.data?.rows ?? []]))
  const analytics = realAnalytics({ now, from, total: total.data?.rows ?? [], byStage: spend, mock })
  const world = realWorld({
    now,
    tasks: tasks.data?.items ?? [],
    stageOf: (agentId) => stages.get(agentId),
    startedWorkingAt: analytics.startedWorkingAt,
  })
  const review = useMutation(api.task.review.mutationOptions())
  const assign = useMutation(api.task.assign.mutationOptions())
  const update = useMutation(api.task.update.mutationOptions())
  const fail = (title: string) => (error: unknown) => toast.error(title, { description: errorMessage(error) })
  const planner = [...stages].find((entry) => entry[1] === "plan")?.[0] ?? space.factory.agents.at(0)?.agentId
  const act = (taskId: string, resolution: Resolution, note?: string) => {
    if (resolution === "approve")
      review.mutate(
        { id: taskId, payload: { humanReview: false, decision: "approved" } },
        { onError: fail("Couldn’t approve the task") },
      )
    if (resolution === "request_changes")
      review.mutate(
        {
          id: taskId,
          payload: { humanReview: false, decision: "changes_requested", comment: note || "Changes requested." },
        },
        { onError: fail("Couldn’t request changes") },
      )
    if ((resolution === "promote" || resolution === "send_to_plan") && planner)
      assign.mutate({ id: taskId, agentId: planner }, { onError: fail("Couldn’t send the task to Plan") })
    if (resolution === "dismiss")
      update.mutate({ id: taskId, status: "dismissed" }, { onError: fail("Couldn’t dismiss the task") })
  }
  return {
    loading: tasks.isPending || agents.isPending,
    world,
    analytics,
    spend,
    act,
    open: (taskId: string) => void navigate({ to: "/tasks/$taskId", params: { taskId } }),
  }
}

export function useStackState() {
  const [stacks, setStacks] = useState<Record<string, boolean>>(loadStacks)
  const setStack = (stage: string, options: { expanded: boolean }) => {
    setStacks((previous) => {
      const next = { ...previous, [stage]: options.expanded }
      writeStored(STACK_KEY, next)
      return next
    })
  }
  return [stacks, setStack] as const
}
