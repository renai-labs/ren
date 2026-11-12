import { createFileRoute } from "@tanstack/react-router"
import { SpaceMembersTab } from "../../../../../features/spaces/space-members.js"
import { Loader } from "../../../../../lib/loader.js"
import { Pages } from "../../../../../lib/pages.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/members")({
  head: () => ({ meta: [{ title: "Members · Space · Ren" }] }),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.infiniteQuery(Pages.spaceMembers(options.context.client, options.params.spaceId)),
    )
  },
  wrapInSuspense: false,
  component: SpaceMembersTab,
})
