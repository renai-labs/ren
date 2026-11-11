import { createFileRoute } from "@tanstack/react-router"
import { EnvironmentsSettingsPage } from "../../../../../features/environments/environments-page.js"
import { Machines } from "../../../../../lib/machines.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin/machines")({
  head: () => ({ meta: [{ title: "Machines · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(Machines.options(options.context.client)),
      options.context.queryClient.query(options.context.api.environmentProvider.list.queryOptions()),
    )
  },
  component: EnvironmentsSettingsPage,
})
