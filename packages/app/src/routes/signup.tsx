import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
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
    if (session === null) return
    throw redirect({ href: CompleteAuth.href(options.search) })
  },
  pendingComponent: AppBoot,
  component: SignupPage,
})

function SignupPage() {
  const search = Route.useSearch()
  return <Signup destination={search} />
}
