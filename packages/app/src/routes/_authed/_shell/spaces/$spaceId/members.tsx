import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpaceMembersTab } from "../../../../../features/spaces/space-members.js"
import { Loader } from "../../../../../lib/loader.js"
import { Pages } from "../../../../../lib/pages.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/members")({
  head: () => ({ meta: [{ title: "Members · Space · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ tab: Schema.optional(Schema.Literals(["members", "requests"])) }),
  ),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.infiniteQuery(Pages.spaceMembers(options.context.client, options.params.spaceId)),
    )
    Loader.start(
      options.context.queryClient.infiniteQuery(
        Pages.spaceJoinRequests(options.context.client, options.params.spaceId),
      ),
    )
  },
  wrapInSuspense: false,
  component: SpaceMembersTab,
})
