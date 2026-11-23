import { createFileRoute } from "@tanstack/react-router"
import { RenModelsPage } from "../../../../../features/providers/ren-models-page.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers/ren-models")({
  head: () => ({ meta: [{ title: "Ren models · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(options.context.api.provider["ren-models"].list.queryOptions()))
  },
  component: RenModelsPage,
})
