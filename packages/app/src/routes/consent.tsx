import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { Consent } from "../features/auth/consent.js"
import { Auth } from "../lib/auth.js"

export const Route = createFileRoute("/consent")({
  head: () => ({ meta: [{ title: "Allow access · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ client_id: Schema.NonEmptyString })),
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(Auth.sessionOptions(options.context.auth))
    if (session === null) throw redirect({ to: "/login" })
    return { session }
  },
  loaderDeps: (options) => ({ clientId: options.search.client_id }),
  loader: async (options) => {
    const context = options.context
    const [client, organizations] = await Promise.all([
      context.queryClient.query(Auth.oauthClientOptions(context.auth, options.deps.clientId)),
      context.queryClient.query(Auth.organizationsOptions(context.auth)),
    ])
    return { client, organizations }
  },
  pendingComponent: AppBoot,
  component: ConsentPage,
})

function ConsentPage() {
  const context = Route.useRouteContext()
  const data = Route.useLoaderData()
  return (
    <Consent
      client={{ name: data.client.client_name ?? data.client.client_id, icon: data.client.logo_uri }}
      email={context.session.user.email}
      organizations={data.organizations}
      activeOrganizationId={context.session.session.activeOrganizationId ?? null}
    />
  )
}
