import { lazy, Suspense } from "react"
import { createLazyFileRoute } from "@tanstack/react-router"
import { TaskPage } from "../../../../../features/tasks/task-page.js"

export const Route = createLazyFileRoute("/_authed/_shell/tasks/$taskId/")({ component: TaskRoute })

const SessionThread = lazy(() =>
  import("../../../../../features/session/chat-page.js").then((module) => ({ default: module.SessionThread })),
)

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
          ? (dock) => (
              <Suspense fallback={null}>
                <SessionThread key={search.session} sessionId={search.session ?? ""} dock={dock} />
              </Suspense>
            )
          : null
      }
    />
  )
}
