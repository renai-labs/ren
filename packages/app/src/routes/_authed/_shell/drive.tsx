import { createFileRoute } from "@tanstack/react-router"
import { DrivePage } from "../../../features/drive/drive-page.js"
import { Loader } from "../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/drive")({
  head: () => ({ meta: [{ title: "Drive · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(options.context.api.files.list.queryOptions({ source: "drive" })))
  },
  component: DrivePage,
})
