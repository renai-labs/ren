import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { MembersPage } from "../../../../../../../features/members/members-page.js"

export const Route = createFileRoute("/_authed/_shell/sessions/settings/_admin/members/")({
  head: () => ({ meta: [{ title: "Members · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ tab: Schema.optionalKey(Schema.Literals(["members", "invitations"])) }),
  ),
  component: MembersRoute,
})

function MembersRoute() {
  const context = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const organization = context.me.organization
  if (organization === null) return null
  return (
    <MembersPage
      key={organization.id}
      organizationId={organization.id}
      userId={context.me.user.id}
      tab={search.tab ?? "members"}
      onTabChange={(tab) => void navigate({ search: tab === "members" ? {} : { tab }, replace: true })}
    />
  )
}
