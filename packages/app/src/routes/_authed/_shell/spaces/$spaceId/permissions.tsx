import { createFileRoute } from "@tanstack/react-router"
import { PagePlaceholder } from "../../../../../components/page-placeholder.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/permissions")({
  head: () => ({ meta: [{ title: "Permissions · Space · Ren" }] }),
  wrapInSuspense: false,
  component: PagePlaceholder,
})
