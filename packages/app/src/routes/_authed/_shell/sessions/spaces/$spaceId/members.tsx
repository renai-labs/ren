import { createFileRoute } from "@tanstack/react-router"
import { SpaceMembers } from "../../../../../../features/spaces/space-members.js"
import { Auth } from "../../../../../../lib/auth.js"

export const Route = createFileRoute("/_authed/_shell/sessions/spaces/$spaceId/members")({
  head: () => ({ meta: [{ title: "Space members · Ren" }] }),
  loader: (options) => {
    const context = options.context
    const organization = context.me.organization
    return Promise.all([
      context.queryClient.query(
        context.api["space-member"].list.queryOptions({ spaceId: options.params.spaceId, page: 1, pageSize: 100 }),
      ),
      ...(organization ? [context.queryClient.query(Auth.organizationOptions(context.auth, organization.id))] : []),
    ])
  },
  component: SpaceMembersRoute,
})

function SpaceMembersRoute() {
  const params = Route.useParams()
  const context = Route.useRouteContext()
  const organization = context.me.organization
  if (!organization) return null
  return <SpaceMembers spaceId={params.spaceId} organizationId={organization.id} userId={context.me.user.id} />
}
