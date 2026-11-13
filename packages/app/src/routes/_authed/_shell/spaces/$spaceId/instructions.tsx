import { createFileRoute } from "@tanstack/react-router"
import { PagePlaceholder } from "../../../../../components/page-placeholder.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/instructions")({
  head: () => ({ meta: [{ title: "Instructions · Space · Ren" }] }),
  wrapInSuspense: false,
  component: PagePlaceholder,
})
