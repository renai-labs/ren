import { createLazyFileRoute } from "@tanstack/react-router"
import { LazySessionThread } from "../../../../../../../features/session/lazy-session-thread.js"
import { TaskPage } from "../../../../../../../features/tasks/task-page.js"
import { TaskScopeProvider } from "../../../../../../../features/tasks/task-scope.js"

export const Route = createLazyFileRoute("/_authed/_shell/spaces/$spaceId/tasks/$taskId/")({ component: TaskRoute })

function TaskRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TaskScopeProvider spaceId={params.spaceId}>
      <TaskPage
        taskId={params.taskId}
        sessionId={search.session}
        onOpenSession={(session) => void navigate({ search: (previous) => ({ ...previous, session }) })}
        session={
          search.session
            ? (dock) => <LazySessionThread key={search.session} sessionId={search.session ?? ""} dock={dock} />
            : null
        }
      />
    </TaskScopeProvider>
  )
}
