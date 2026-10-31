import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { useState } from "react"
import { AppShell } from "../../components/app-shell.js"
import { AppSidebar } from "../../components/app-sidebar.js"
import { RouteError } from "../../components/error-page.js"
import { SettingsSidebar } from "../../components/settings-sidebar.js"
import { WorkspaceSearch } from "../../components/workspace-search.js"
import { ProfileCard } from "../../features/organization/profile-card.js"
import { ChatFilterMenu, ChatList, type ChatFilters } from "../../features/session/chat-list.js"
import { SpaceSidebar } from "../../features/spaces/space-sidebar.js"
import { SpacesNav } from "../../features/spaces/spaces-nav.js"
import { Keyboard } from "../../platform/keyboard.js"

const settingsPath = /^\/settings(?:\/|$)/

const spacePath = /^\/spaces\/([^/]+)/

export const Route = createFileRoute("/_authed/_shell")({
  head: () => ({ meta: [{ title: "Ren" }] }),
  errorComponent: (props) => <RouteError error={props.error} />,
  component: Shell,
})

function Shell() {
  const context = Route.useRouteContext()
  const me = useQuery(context.api.me.get.queryOptions()).data ?? context.me
  const inSettings = useRouterState({ select: (state) => settingsPath.test(state.location.pathname) })
  const spaceId = useRouterState({ select: (state) => spacePath.exec(state.location.pathname)?.[1] })
  const organization = me.organization
  const [searching, setSearching] = useState(false)
  const [chatFilters, setChatFilters] = useState<ChatFilters>({})
  Keyboard.useKeyDown((event) => {
    if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey) return
    event.preventDefault()
    setSearching((open) => !open)
  })
  const footer = organization === null ? null : <ProfileCard user={me.user} organization={organization} />
  const sidebar = () => {
    if (inSettings) return <SettingsSidebar />
    if (spaceId) return <SpaceSidebar spaceId={spaceId} footer={footer} />
    return (
      <AppSidebar
        onSearch={() => setSearching(true)}
        spaces={<SpacesNav />}
        chats={<ChatList filters={chatFilters} />}
        chatsAction={<ChatFilterMenu value={chatFilters} onChange={setChatFilters} />}
        footer={footer}
      />
    )
  }
  return (
    <AppShell sidebar={sidebar()}>
      <Outlet />
      {searching ? <WorkspaceSearch onClose={() => setSearching(false)} /> : null}
    </AppShell>
  )
}
