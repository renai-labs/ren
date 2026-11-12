import { createFileRoute } from "@tanstack/react-router"
import { AppPage } from "../../../../../features/apps/app-page.js"

export const Route = createFileRoute("/_authed/_shell/apps/$appId/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  component: AppPage,
})
