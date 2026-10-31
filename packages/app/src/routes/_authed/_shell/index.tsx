import { createFileRoute } from "@tanstack/react-router"
import { HomePage } from "../../../features/session/home-page.js"
import { pickerPageSize } from "../../../lib/pagination.js"
import { Loader } from "../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/")({
  head: () => ({ meta: [{ title: "New chat · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
      ),
    )
  },
  component: HomePage,
})
