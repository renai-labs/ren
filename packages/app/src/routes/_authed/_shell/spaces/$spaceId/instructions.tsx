import { createFileRoute } from "@tanstack/react-router"
import { SpaceInstructionsTab } from "../../../../../features/spaces/space-instructions.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/instructions")({
  head: () => ({ meta: [{ title: "Instructions · Space · Ren" }] }),
  wrapInSuspense: false,
  component: SpaceInstructionsTab,
})
