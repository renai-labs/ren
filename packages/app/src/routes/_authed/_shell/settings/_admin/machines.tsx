import { createFileRoute } from "@tanstack/react-router"
import { EnvironmentsSettingsPage } from "../../../../../features/environments/environments-page.js"
import { EnvironmentForm } from "../../../../../features/environments/environment-form.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin/machines")({
  head: () => ({ meta: [{ title: "Machines · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["environment-template"].list.queryOptions(EnvironmentForm.listInput),
      ),
      options.context.queryClient.query(options.context.api.environmentProvider.list.queryOptions()),
    )
  },
  component: EnvironmentsSettingsPage,
})
