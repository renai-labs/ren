import { createFileRoute, Outlet } from "@tanstack/react-router"
import { AppBoot } from "../../components/app-boot.js"
import { ApplicationSidebar, ApplicationSidebarBrand } from "../../components/application-sidebar.js"
import { RouteError } from "../../components/error-page.js"
import { WorkspaceLayout } from "../../components/workspace-layout.js"
import { ProfileCard } from "../../features/organization/profile-card.js"

export const Route = createFileRoute("/_authed/_shell")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  pendingComponent: AppBoot,
  errorComponent: (props) => <RouteError error={props.error} />,
  component: Shell,
})

function Shell() {
  const context = Route.useRouteContext()
  const organization = context.me.organization
  return (
    <WorkspaceLayout
      header={<ApplicationSidebarBrand />}
      navigation={<ApplicationSidebar onSearch={() => undefined} />}
      footer={organization === null ? null : <ProfileCard user={context.me.user} organization={organization} />}
    >
      <Outlet />
    </WorkspaceLayout>
  )
}
