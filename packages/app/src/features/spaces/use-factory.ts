import type { SpaceInfo } from "@ren/client"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  SPEND_STAGES,
  buildAnalytics,
  gridEnd,
  gridStart,
  simulate,
  type Resolution,
  type WorkStage,
} from "@ren/ui/factory-model"
import { toast } from "@ren/ui/sonner"
import { localTimeZone } from "@ren/ui/time"
import { errorMessage } from "../../lib/errors.js"
import { realAnalytics, realWorld, spendToday, stageOfAgent } from "../../lib/factory.js"
import { allTasksOptions } from "../../lib/tasks.js"
import { useNow } from "../../lib/use-now.js"
import { spaceAgentsOptions } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

const timezone = localTimeZone()

const mock = buildAnalytics(simulate(Date.now()))

export function useFactory(space: SpaceInfo) {
  const { api, client } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const now = useNow()
  const tasks = useQuery(allTasksOptions(client, { spaceId: space.id, parentId: "none" }))
  const agents = useQuery(spaceAgentsOptions(api, space.id))
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
    spend: spendToday(spend, now),
    act,
    open: (taskId: string) => void navigate({ to: "/tasks/$taskId", params: { taskId } }),
  }
}
