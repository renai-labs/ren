import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../../components/app-boot.js"
import { AcceptInvitationPage } from "../../features/invitation/accept-invitation-page.js"
import { sessionOptions } from "../../lib/auth.js"
import { joinInvitation } from "../../lib/invitation.js"
import { Routing } from "../../lib/routing.js"

export const Route = createFileRoute("/invites/accept")({
  head: () => ({ meta: [{ title: "Join organization · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      join: Schema.optional(Schema.Boolean),
      redirect: Routing.Redirect,
    }),
  ),
  loaderDeps: (options) => options.search,
  loader: async (options) => {
    const deps = options.deps
    if (!deps.id) return {}
    const queryClient = options.context.queryClient
    const [session, preview] = await Promise.all([
      queryClient.query(sessionOptions(options.context.auth)),
      queryClient
        .query({ ...options.context.api.invitation.preview.queryOptions({ id: deps.id }), retry: false })
        .catch(() => undefined),
    ])
    const organization = preview?.organization
    if (!deps.join || !session || preview?.state !== "pending" || !organization) return {}
    const outcome = await joinInvitation(options.context, {
      invitationId: deps.id,
      organizationId: organization.id,
      redirect: deps.redirect,
    })
    if (outcome.kind === "opened") throw redirect({ href: outcome.href })
    return { failure: outcome }
  },
  pendingComponent: AppBoot,
  component: AcceptInvitationPage,
})
