import { useState } from "react"
import type { TaskInfo, TaskUpdateInput } from "@ren/client"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useAgents } from "@/hooks/use-agents"
import { useLabels } from "@/hooks/use-labels"
import { useMembers } from "@/hooks/use-members"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage, pickerPageSize } from "@/lib/api"
import { seedFromLists } from "@/lib/cache"
import { allTasksKey } from "@/lib/tasks"

const route = getRouteApi("/_authed/_shell/tasks/$taskId")

type Patch = Omit<TaskUpdateInput, "id">

export function useTaskPage() {
  const params = route.useParams()
  const navigate = useNavigate()
  const task = useSuspenseQuery({
    ...api.task.get.queryOptions({ idOrSlug: params.taskId }),
    ...seedFromLists<TaskInfo>([api.task.list.queryKey(), allTasksKey()], params.taskId),
  }).data
  const subtasks = useQuery(
    api.task.list.queryOptions({ parentId: task.id, includeDone: true, page: 1, pageSize: pickerPageSize }),
  )
  const activity = useQuery(
    api["task-activity"].list.queryOptions({ taskId: task.id, page: 1, pageSize: pickerPageSize }),
  )
  const agents = useAgents()
  const members = useMembers()
  const spaces = useSpaces()
  const labels = useLabels()
  const [session, setSession] = useState<string>()
  const [archiving, setArchiving] = useState(false)
  const [comment, setComment] = useState("")
  const fail = (title: string) => (error: Error) => toast.error(title, { description: errorMessage(error) })
  const update = useMutation({
    ...api.task.update.mutationOptions(),
    meta: { invalidates: [api["task-activity"].list.queryKey()] },
  })
  const assign = useMutation({
    ...api.task.assign.mutationOptions(),
    meta: { invalidates: [api["task-activity"].list.queryKey()] },
  })
  const review = useMutation({
    ...api.task.review.mutationOptions(),
    meta: { invalidates: [api["task-activity"].list.queryKey()] },
  })
  const start = useMutation(api.task.start.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const createComment = useMutation({
    ...api["task-comment"].create.mutationOptions(),
    meta: { invalidates: [api["task-activity"].list.queryKey()] },
  })
  const pending = update.isPending ? update.variables : undefined
  const shown: TaskInfo = pending ? { ...task, ...pickShown(pending) } : task
  const owner = members.member(task.ownerId)
  const agent = agents.agent(task.agentId)
  return {
    task: shown,
    subtasks: subtasks.data?.items ?? [],
    activity: (activity.data?.items ?? []).flatMap((item) => (item.type === "comment" ? [item.comment] : [])),
    authorName: (author: { userId: string | null; agentId: string | null }) =>
      author.agentId
        ? (agents.agent(author.agentId)?.name ?? "Agent")
        : (members.member(author.userId)?.name ?? "Member"),
    agents: agents.agents,
    members: members.members,
    spaces: spaces.spaces,
    labels,
    spaceName: spaces.spaceName(task.spaceId),
    owner,
    assignee: agent?.name ?? owner?.name ?? null,
    session,
    openSession: setSession,
    archiving,
    setArchiving,
    comment,
    setComment,
    commenting: createComment.isPending,
    starting: start.isPending,
    set: (patch: Patch) => update.mutate({ id: task.id, ...patch }, { onError: fail("Couldn’t save the task") }),
    assignTo: (target: { agentId?: string | null; ownerId?: string | null; spaceId?: string }) =>
      assign.mutate({ id: task.id, start: "none", ...target }, { onError: fail("Couldn’t reassign the task") }),
    requestReview: () =>
      review.mutate(
        { id: task.id, payload: { humanReview: true, reason: "Requested from the task page" } },
        { onError: fail("Couldn’t request a review") },
      ),
    decide: (decision: "approved" | "changes_requested") =>
      review.mutate(
        { id: task.id, payload: { humanReview: false, decision } },
        { onError: fail("Couldn’t send the review") },
      ),
    start: (mode: "new" | "continue") =>
      start.mutate(
        { id: task.id, mode },
        {
          onSuccess: (started) => {
            if (started.session) setSession(started.session.id)
          },
          onError: fail("Couldn’t start the task"),
        },
      ),
    archive: () =>
      archive.mutateAsync(
        { id: task.id },
        {
          onSuccess: () => {
            toast.success(`${task.identifier} archived`)
            void navigate({ to: "/tasks" })
          },
          onError: fail("Couldn’t archive the task"),
        },
      ),
    sendComment: () => {
      const body = comment.trim()
      if (!body) return
      createComment.mutate(
        { taskId: task.id, body },
        { onSuccess: () => setComment(""), onError: fail("Couldn’t post the comment") },
      )
    },
  }
}

function pickShown(patch: Patch): Partial<TaskInfo> {
  return {
    ...(patch.status && { status: patch.status }),
    ...(patch.priority !== undefined && { priority: patch.priority }),
    ...(patch.dueAt !== undefined && { dueAt: patch.dueAt }),
  }
}
