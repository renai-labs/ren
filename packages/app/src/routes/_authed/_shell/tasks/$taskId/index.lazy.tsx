import { createLazyFileRoute } from "@tanstack/react-router"
import { SessionThread } from "../../../../../features/session/chat-page.js"
import { TaskPage } from "../../../../../features/tasks/task-page.js"

export const Route = createLazyFileRoute("/_authed/_shell/tasks/$taskId/")({ component: TaskRoute })

function TaskRoute() {
  const search = Route.useSearch()
  return (
    <TaskPage session={search.session ? <SessionThread key={search.session} sessionId={search.session} /> : null} />
  )
}
