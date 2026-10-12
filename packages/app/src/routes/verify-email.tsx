import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { AuthSchemas } from "../features/auth/schemas.js"
import { VerifyEmail } from "../features/auth/verify-email.js"
import { Auth } from "../lib/auth.js"

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify your email · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      email: AuthSchemas.OptionalEmail,
      invitationId: AuthSchemas.InvitationId,
      redirect: AuthSchemas.Redirect,
    }),
  ),
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(Auth.sessionOptions(options.context.auth))
    if (session !== null) throw redirect({ href: options.search.redirect ?? "/" })
    if (options.search.email === undefined) {
      throw redirect({
        to: "/login",
        search: { invitationId: options.search.invitationId, redirect: options.search.redirect },
      })
    }
    return { email: options.search.email }
  },
  pendingComponent: AppBoot,
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const search = Route.useSearch()
  const context = Route.useRouteContext()
  return (
    <VerifyEmail email={context.email} destination={{ invitationId: search.invitationId, redirect: search.redirect }} />
  )
}
