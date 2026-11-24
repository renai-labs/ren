import type { TaskInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { IconPlayerPlay } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { RowMenu, type RowMenuItem } from "../../components/row-menu.js"
import { RouterContext } from "../../lib/router-context.js"
import { TaskScopeContext } from "./task-scope-context.js"
import { TaskActions } from "./task-actions.js"

export function TaskCardActions(props: { task: TaskInfo; actions: ReadonlyArray<RowMenuItem> }) {
  const { api } = RouterContext.useRouterContext()
  const scope = TaskScopeContext.useOpen()
  const task = props.task
  const start = useMutation(api.task.start.mutationOptions())
  const open = (session?: string) => scope.task(task.id, session)
  return (
    <span className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-1 rounded-md bg-card opacity-0 transition-opacity duration-150 ease-out group-hover/card:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
      <RowMenu label={`Actions for ${task.title}`} className="flex text-muted-foreground" items={props.actions} />
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
                onError: TaskActions.failed("Couldn’t start the task"),
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
