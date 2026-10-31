import { createFileRoute } from "@tanstack/react-router"
import { AppBoot } from "../../components/app-boot.js"
import { AppShell } from "../../components/app-shell.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { Loader } from "../../lib/loader.js"
import { ownChats, sidebarSessionsOptions } from "../../lib/sessions.js"

export const Route = createFileRoute("/_authed/_shell")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.infiniteQuery(
        sidebarSessionsOptions(options.context.client, ownChats(options.context.me.user.id)),
      ),
      options.context.queryClient.query(
        options.context.api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
      ),
    )
  },
  pendingComponent: AppBoot,
  component: AppShell,
})
