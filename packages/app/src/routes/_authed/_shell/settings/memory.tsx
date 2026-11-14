import { createFileRoute } from "@tanstack/react-router"
import { MemorySettingsPage } from "../../../../features/organization/memory-page.js"
import { Loader } from "../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/memory")({
  head: () => ({ meta: [{ title: "Memory · Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.query(options.context.api.files.list.queryOptions({ source: "memory" })))
  },
  wrapInSuspense: false,
  component: MemorySettingsPage,
})
