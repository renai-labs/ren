import { SessionPages } from "@ren/client/react"
import { createFileRoute } from "@tanstack/react-router"
import { AppBoot } from "../../components/app-boot.js"
import { AppShell } from "../../components/app-shell.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { canAdministerOptions } from "../../lib/auth.js"
import { Loader } from "../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.infiniteQuery(
        SessionPages.options(options.context.client, SessionPages.own(options.context.me.user.id)),
      ),
      options.context.queryClient.query(
        options.context.api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
      ),
      options.context.queryClient.query(canAdministerOptions(options.context.auth)),
    )
  },
  pendingComponent: AppBoot,
  component: AppShell,
})
