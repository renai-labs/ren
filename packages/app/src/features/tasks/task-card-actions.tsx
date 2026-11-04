import type { TaskInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { IconArchive, IconCircleCheck, IconCircleX, IconExternalLink, IconPlayerPlay } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/sonner"
import { RowMenu } from "../../components/row-menu.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"

const failed = (title: string) => (error: unknown) => toast.error(title, { description: errorMessage(error) })

export function TaskCardActions(props: { task: TaskInfo }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const task = props.task
  const start = useMutation(api.task.start.mutationOptions())
  const update = useMutation(api.task.update.mutationOptions())
  const archive = useMutation(api.task.archive.mutationOptions())
  const open = (session?: string) =>
    void navigate({ to: "/tasks/$taskId", params: { taskId: task.id }, search: session ? { session } : {} })
  return (
    <span className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-1 rounded-md bg-card opacity-0 transition-opacity duration-150 ease-out group-hover/card:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
      <RowMenu
        label={`Actions for ${task.title}`}
        className="flex text-muted-foreground"
        items={[
          { label: "Open", icon: IconExternalLink, onSelect: () => open() },
          {
            label: "Mark done",
            icon: IconCircleCheck,
            onSelect: () => update.mutateAsync({ id: task.id, status: "done" }, { onError: failed("Couldn’t save") }),
          },
          {
            label: "Dismiss",
            icon: IconCircleX,
            onSelect: () =>
              update.mutateAsync({ id: task.id, status: "dismissed" }, { onError: failed("Couldn’t save") }),
          },
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
              title: "Archive this task?",
              description: "It leaves the task list. Its chats stay.",
              action: "Archive",
            },
          },
        ]}
      />
      {task.agentId ? (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Start ${task.title}`}
          disabled={start.isPending}
          onClick={() =>
            start.mutate(
              { id: task.id, mode: "new" },
              {
                onSuccess: (started) => open(started.session?.id),
                onError: failed("Couldn’t start the task"),
              },
            )
          }
        >
          {start.isPending ? <Spinner data-icon="inline-start" /> : <IconPlayerPlay data-icon="inline-start" />}
          Start
        </Button>
      ) : null}
    </span>
  )
}
