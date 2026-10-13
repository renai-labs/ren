import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { useState } from "react"
import { AppBoot } from "../../components/app-boot.js"
import { ApplicationSidebar, ApplicationSidebarBrand } from "../../components/application-sidebar.js"
import { RouteError } from "../../components/error-page.js"
import { SettingsSidebar } from "../../components/settings-sidebar.js"
import { WorkspaceLayout } from "../../components/workspace-layout.js"
import { WorkspaceSearch } from "../../components/workspace-search.js"
import { ProfileCard } from "../../features/organization/profile-card.js"
import { Keyboard } from "../../platform/keyboard.js"

const settingsPath = /^\/settings(?:\/|$)/

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
  const [searching, setSearching] = useState(false)
  Keyboard.useKeyDown((event) => {
    if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey) return
    event.preventDefault()
    setSearching((open) => !open)
  })
  return (
    <WorkspaceLayout
      header={inSettings ? null : <ApplicationSidebarBrand />}
      navigation={inSettings ? <SettingsSidebar /> : <ApplicationSidebar onSearch={() => setSearching(true)} />}
      footer={inSettings || organization === null ? null : <ProfileCard user={me.user} organization={organization} />}
    >
      <Outlet />
      {searching ? <WorkspaceSearch onClose={() => setSearching(false)} /> : null}
    </WorkspaceLayout>
  )
}
