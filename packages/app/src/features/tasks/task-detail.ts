export * as TaskDetail from "./task-detail.js"

import type { TaskInfo } from "@ren/client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"

export function useActions() {
  const context = RouterContext.useRouterContext()
  const client = useQueryClient()
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: context.api.task.get.queryKey() }),
      client.invalidateQueries({ queryKey: context.api.task.list.queryKey() }),
      client.invalidateQueries({ queryKey: context.api["task-activity"].list.queryKey() }),
      client.invalidateQueries({ queryKey: context.api.label.list.queryKey() }),
    ])
  return {
    update: useMutation({ ...context.api.task.update.mutationOptions(), onSuccess: refresh }),
    assign: useMutation({ ...context.api.task.assign.mutationOptions(), onSuccess: refresh }),
    start: useMutation({ ...context.api.task.start.mutationOptions(), onSuccess: refresh }),
    review: useMutation({ ...context.api.task.review.mutationOptions(), onSuccess: refresh }),
    archive: useMutation({ ...context.api.task.archive.mutationOptions(), onSuccess: refresh }),
    comment: useMutation({ ...context.api["task-comment"].create.mutationOptions(), onSuccess: refresh }),
    editComment: useMutation({ ...context.api["task-comment"].update.mutationOptions(), onSuccess: refresh }),
    archiveComment: useMutation({ ...context.api["task-comment"].archive.mutationOptions(), onSuccess: refresh }),
  }
}

export const isActionable = (task: TaskInfo) => task.status === "todo" || task.status === "in_progress"
