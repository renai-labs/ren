import { createLazyFileRoute } from "@tanstack/react-router"
import { SessionThread } from "../../../../../features/session/chat-page.js"
import { TaskPage } from "../../../../../features/tasks/task-page.js"

export const Route = createLazyFileRoute("/_authed/_shell/tasks/$taskId/")({ component: TaskRoute })

function TaskRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TaskPage
      taskId={params.taskId}
      sessionId={search.session}
      onOpenSession={(session) => void navigate({ search: (previous) => ({ ...previous, session }) })}
      session={
        search.session
          ? (dock) => <SessionThread key={search.session} sessionId={search.session ?? ""} dock={dock} />
          : null
      }
    />
  )
}
