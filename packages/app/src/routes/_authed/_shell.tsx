import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { useState } from "react"
import { AppShell } from "../../components/app-shell.js"
import { AppSidebar } from "../../components/app-sidebar.js"
import { RouteError } from "../../components/error-page.js"
import { SettingsSidebar } from "../../components/settings-sidebar.js"
import { WorkspaceSearch } from "../../components/workspace-search.js"
import { ProfileCard } from "../../features/organization/profile-card.js"
import { ChatList } from "../../features/session/chat-list.js"
import { Loader } from "../../lib/loader.js"
import { SessionList } from "../../lib/session-list.js"
import { Keyboard } from "../../platform/keyboard.js"

const settingsPath = /^\/settings(?:\/|$)/

export const Route = createFileRoute("/_authed/_shell")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  loader: (options) => {
    Loader.start(options.context.queryClient.infiniteQuery(SessionList.sidebarOptions(options.context.client)))
  },
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
    <AppShell
      sidebar={
        inSettings ? (
          <SettingsSidebar />
        ) : (
          <AppSidebar
            onSearch={() => setSearching(true)}
            chats={<ChatList />}
            footer={organization === null ? null : <ProfileCard user={me.user} organization={organization} />}
          />
        )
      }
    >
      <Outlet />
      {searching ? <WorkspaceSearch onClose={() => setSearching(false)} /> : null}
    </AppShell>
  )
}
