import { createLazyFileRoute } from "@tanstack/react-router"
import { Session } from "@ren/schema/session"
import { SessionPanel } from "../../../../../features/session/session-panel.js"
import { TaskDetailPage } from "../../../../../features/tasks/task-detail-page.js"

export const Route = createLazyFileRoute("/_authed/_shell/tasks/$taskId/")({ component: TaskRoute })

function TaskRoute() {
  const context = Route.useRouteContext()
  const params = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const openSession = (id: string) => {
    void navigate({ search: { session: Session.ID.make(id) }, replace: true })
  }
  if (!context.me.organization) return null
  return (
    <>
      <TaskDetailPage
        taskId={params.taskId}
        userId={context.me.user.id}
        organizationId={context.me.organization.id}
        onOpenSession={openSession}
        onArchived={() => void navigate({ to: "/tasks" })}
      />
      {search.session ? (
        <SessionPanel
          key={search.session}
          sessionId={search.session}
          child={search.child}
          onChild={(child) =>
            void navigate({
              search: (previous) => ({
                ...(previous.session && { session: previous.session }),
                ...(child && { child }),
              }),
              replace: true,
            })
          }
          onClose={() => void navigate({ search: {}, replace: true })}
          onNavigate={openSession}
        />
      ) : null}
    </>
  )
}
