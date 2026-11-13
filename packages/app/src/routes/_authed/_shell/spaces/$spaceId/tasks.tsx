import { createFileRoute } from "@tanstack/react-router"
import { SpaceTasksTab } from "../../../../../features/spaces/space-tasks.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/tasks")({
  head: () => ({ meta: [{ title: "Tasks · Space · Ren" }] }),
  wrapInSuspense: false,
  component: SpaceTasksTab,
})
