import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { AuthFlowLayout } from "../features/auth/auth-flow-layout.js"
import { CompleteAuth } from "../features/auth/complete-auth.js"
import { AuthSchemas } from "../features/auth/schemas.js"
import { Signup } from "../features/auth/signup.js"
import { Auth } from "../lib/auth.js"

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create your account · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ invitationId: AuthSchemas.InvitationId, redirect: AuthSchemas.Redirect }),
  ),
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(Auth.sessionOptions(options.context.auth))
    if (session !== null) throw redirect({ href: CompleteAuth.href(options.search) })
  },
  loaderDeps: (options) => ({ invitationId: options.search.invitationId, redirect: options.search.redirect }),
  loader: async (options) => {
    const invitationId = options.deps.invitationId
    if (invitationId === undefined) return {}
    const preview = await options.context.queryClient
      .query({ ...options.context.api.invitation.preview.queryOptions({ id: invitationId }), retry: false })
      .catch(() => undefined)
    if (preview?.state !== "pending" || preview.organization === null) {
      throw redirect({
        to: "/invites/accept",
        search: { id: invitationId, redirect: options.deps.redirect },
        replace: true,
      })
    }
    return { organizationName: preview.organization.name }
  },
  pendingComponent: SignupPending,
  component: SignupPage,
})

function SignupPending() {
  const search = Route.useSearch()
  if (search.invitationId === undefined) return <AppBoot />
  return <AuthFlowLayout title="Loading invitation…" description="" />
}

function SignupPage() {
  const search = Route.useSearch()
  const data = Route.useLoaderData()
  if (data.organizationName === undefined) return <Signup destination={search} />
  return <Signup destination={search} title={`Join ${data.organizationName}`} description="Create your Ren account" />
}
