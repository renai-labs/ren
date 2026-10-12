import { PublicShell } from "@ren/ui/public-shell"
import { Text } from "@ren/ui/text"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AuthSchemas } from "../../features/auth/schemas.js"
import { AcceptInvitation } from "../../features/invitation/accept-invitation.js"
import { InvitationActions } from "../../features/invitation/invitation-actions.js"
import { InvitationSchemas } from "../../features/invitation/schemas.js"
import { Auth } from "../../lib/auth.js"

export const Route = createFileRoute("/invites/accept")({
  head: () => ({ meta: [{ title: "Join organization · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ id: InvitationSchemas.Id, join: InvitationSchemas.Join, redirect: AuthSchemas.Redirect }),
  ),
  loaderDeps: (options) => options.search,
  loader: async (options) => {
    const context = options.context
    const [session, preview] = await Promise.all([
      context.queryClient.query(Auth.sessionOptions(context.auth)),
      context.queryClient
        .query({ ...context.api.invitation.preview.queryOptions({ id: options.deps.id }), retry: false })
        .catch(() => undefined),
    ])
    const organization = preview?.organization
    if (!options.deps.join || session === null || preview?.state !== "pending" || organization == null) return {}
    const outcome = await InvitationActions.join(context, {
      invitationId: options.deps.id,
      organizationId: organization.id,
      redirect: options.deps.redirect,
    })
    if (outcome.kind === "opened") throw redirect({ href: outcome.href })
    return { failure: outcome }
  },
  pendingComponent: LoadingInvitation,
  component: AcceptInvitationPage,
})

function LoadingInvitation() {
  return (
    <PublicShell.Centered frame="none">
      <Text tone="secondary" element="div" alignment="center">
        Loading invitation…
      </Text>
    </PublicShell.Centered>
  )
}

function AcceptInvitationPage() {
  const search = Route.useSearch()
  const data = Route.useLoaderData()
  return <AcceptInvitation id={search.id} redirect={search.redirect} failure={data.failure} />
}
