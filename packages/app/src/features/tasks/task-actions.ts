export * as TaskActions from "./task-actions.js"

import type { TaskInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { IconArchive, IconCircleCheck, IconCircleX, IconCopy, IconExternalLink } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import type { RowMenuItem } from "../../components/row-menu.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { useCopy } from "../../lib/use-copy.js"
import { TaskScopeContext } from "./task-scope-context.js"

export const failed = (title: string) => (error: unknown) => toast.error(title, { description: errorMessage(error) })

export const overdue = (task: Pick<TaskInfo, "status" | "dueAt">, now: number) =>
  task.dueAt !== null &&
  task.status !== "done" &&
  task.status !== "dismissed" &&
  Date.parse(task.dueAt) < new Date(now).setHours(0, 0, 0, 0)

export function useItems(task: TaskInfo): ReadonlyArray<RowMenuItem> {
  const { api } = RouterContext.useRouterContext()
  const scope = TaskScopeContext.useOpen()
  const update = useMutation(api.task.update.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const copy = useCopy()
  const setStatus = (status: "done" | "dismissed") =>
    update.mutateAsync({ id: task.id, status }, { onError: failed("Couldn’t save the task") })
  return [
    { label: "Open", icon: IconExternalLink, onSelect: () => scope.task(task.id) },
    ...(copy
      ? [{ label: "Copy ID", icon: IconCopy, onSelect: () => copy(task.identifier, `${task.identifier} copied`) }]
      : []),
    ...(task.status === "done"
      ? []
      : [{ label: "Mark done", icon: IconCircleCheck, onSelect: () => setStatus("done") }]),
    ...(task.status === "dismissed"
      ? []
      : [{ label: "Dismiss", icon: IconCircleX, onSelect: () => setStatus("dismissed") }]),
    {
      label: "Archive",
      icon: IconArchive,
      onSelect: () =>
        archive.mutateAsync(
          { id: task.id },
          {
            onSuccess: () => toast.success(`${task.identifier} archived`),
            onError: failed("Couldn’t archive the task"),
          },
        ),
      confirm: {
        title: `Archive ${task.identifier}?`,
        description: "It leaves the task list. Its chats stay.",
        action: "Archive",
      },
    },
  ]
}
