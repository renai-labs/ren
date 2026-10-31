import { createFileRoute } from "@tanstack/react-router"
import { SpaceCredentialsTab } from "../../../../../features/spaces/space-credentials.js"
import { Routing } from "../../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/credentials")({
  head: () => ({ meta: [{ title: "Keys · Space · Ren" }] }),
  validateSearch: Routing.PageSearch,
  component: SpaceCredentialsTab,
})
