import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { AppBoot } from "../../components/app-boot.js"
import { ApplicationSidebar, ApplicationSidebarBrand } from "../../components/application-sidebar.js"
import { RouteError } from "../../components/error-page.js"
import { SettingsSidebar } from "../../components/settings-sidebar.js"
import { WorkspaceLayout } from "../../components/workspace-layout.js"
import { ProfileCard } from "../../features/organization/profile-card.js"

const settingsPath = /^\/sessions\/settings(?:\/|$)/

export const Route = createFileRoute("/_authed/_shell")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  pendingComponent: AppBoot,
  errorComponent: (props) => <RouteError error={props.error} />,
  component: Shell,
})

function Shell() {
  const context = Route.useRouteContext()
  const me = useQuery(context.api.me.get.queryOptions()).data ?? context.me
  const inSettings = useRouterState({ select: (state) => settingsPath.test(state.location.pathname) })
  const organization = me.organization
  return (
    <WorkspaceLayout
      header={inSettings ? null : <ApplicationSidebarBrand />}
      navigation={inSettings ? <SettingsSidebar /> : <ApplicationSidebar onSearch={() => undefined} />}
      footer={inSettings || organization === null ? null : <ProfileCard user={me.user} organization={organization} />}
    >
      <Outlet />
    </WorkspaceLayout>
  )
}
