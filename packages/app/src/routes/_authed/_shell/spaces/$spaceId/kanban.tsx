import { createFileRoute } from "@tanstack/react-router"
import { SpaceKanbanTab } from "../../../../../features/spaces/space-kanban.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/kanban")({
  head: () => ({ meta: [{ title: "Kanban · Space · Ren" }] }),
  component: SpaceKanbanTab,
})
