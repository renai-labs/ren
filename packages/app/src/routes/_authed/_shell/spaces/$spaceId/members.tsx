import { createFileRoute } from "@tanstack/react-router"
import { SpaceMembersTab } from "../../../../../features/spaces/space-members.js"
import { pageSize, currentPage } from "../../../../../lib/pagination.js"
import { Loader } from "../../../../../lib/loader.js"
import { Routing } from "../../../../../lib/routing.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/members")({
  head: () => ({ meta: [{ title: "Members · Space · Ren" }] }),
  validateSearch: Routing.PageSearch,
  loaderDeps: (options) => ({ page: currentPage(options.search) }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(
        options.context.api["space-member"].list.queryOptions({
          spaceId: options.params.spaceId,
          page: options.deps.page,
          pageSize,
        }),
      ),
    )
  },
  component: SpaceMembersTab,
})
