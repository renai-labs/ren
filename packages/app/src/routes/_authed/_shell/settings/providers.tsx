import { createFileRoute } from "@tanstack/react-router"
import { ProvidersPage } from "../../../../features/providers/providers-page.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers")({
  head: () => ({ meta: [{ title: "Providers · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(options.context.api["ren-inference"].connection.list.queryOptions()))
  },
  component: ProvidersPage,
})
