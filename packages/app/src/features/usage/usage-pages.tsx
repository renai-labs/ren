import { getRouteApi } from "@tanstack/react-router"
import { Page } from "../../components/page.js"
import { UsageBalances } from "./usage-balances.js"
import { UsageView } from "./usage-view.js"

const spaceRoute = getRouteApi("/_authed/_shell/spaces/$spaceId/usage")
const organizationRoute = getRouteApi("/_authed/_shell/settings/_admin/usage")

export function SpaceUsageTab(props: { spaceId: string }) {
  const navigate = spaceRoute.useNavigate()
  return (
    <UsageView
      scope={{ spaceId: props.spaceId }}
      search={spaceRoute.useSearch()}
      onSearchChange={(next) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true })}
    />
  )
}

export function OrganizationUsagePage() {
  const navigate = organizationRoute.useNavigate()
  return (
    <Page title="Usage" width="wide">
      <UsageView
        actions={<UsageBalances />}
        scope={{}}
        search={organizationRoute.useSearch()}
        onSearchChange={(next) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true })}
      />
    </Page>
  )
}
