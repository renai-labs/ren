import { createFileRoute } from "@tanstack/react-router"
import { SpacesPage } from "../../../../features/spaces/spaces-page.js"
import { Loader } from "../../../../lib/loader.js"
import { Pages } from "../../../../lib/pages.js"

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  head: () => ({ meta: [{ title: "Spaces · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.infiniteQuery(Pages.spaces(options.context.client)))
  },
  component: SpacesPage,
})
