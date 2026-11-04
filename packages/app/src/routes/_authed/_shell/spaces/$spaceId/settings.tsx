import { createFileRoute } from "@tanstack/react-router"
import { SpaceSettingsTab } from "../../../../../features/spaces/space-settings.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/settings")({
  head: () => ({ meta: [{ title: "Settings · Space · Ren" }] }),
  wrapInSuspense: false,
  component: SpaceSettingsTab,
})
