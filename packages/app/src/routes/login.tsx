import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { CompleteAuth } from "../features/auth/complete-auth.js"
import { Login } from "../features/auth/login.js"
import { AuthSchemas } from "../features/auth/schemas.js"
import { Auth } from "../lib/auth.js"

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      invitationId: AuthSchemas.InvitationId,
      redirect: AuthSchemas.Redirect,
      sig: AuthSchemas.AuthorizationSignature,
    }),
  ),
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(Auth.sessionOptions(options.context.auth))
    if (session !== null && options.search.sig === undefined)
      throw redirect({ href: CompleteAuth.href(options.search) })
  },
  pendingComponent: AppBoot,
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch()
  return (
    <Login
      destination={{
        invitationId: search.invitationId,
        redirect: search.redirect,
        authorization: search.sig !== undefined,
      }}
    />
  )
}
