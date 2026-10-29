import { useState } from "react"
import { EmptyState } from "@/components/ren/empty-state"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import { AddToSpace, type Added } from "@/components/ren/add-to-space"
import { AccountList, AppGrid, AppRow, AppSheet } from "@/components/ren/app-list"
import { ToolbarSearch } from "@/components/ren/toolbar-search"
import { Page, PageTabsList, PageTabsTrigger, SkeletonRows } from "@/components/ren/page"
import { ProfileDialog, type ProfileTarget } from "@/components/ren/profile-dialog"
import { ListPagination } from "@/components/ren/list-pagination"
import { useCatalog } from "@/hooks/use-catalog"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSpaces } from "@/hooks/use-spaces"
import { api, pageSize } from "@/lib/api"
import { audience, connectLabel, fromRegistry, needsAttention, summary } from "@/lib/apps"
import { currentPage } from "@/lib/pagination"

const route = getRouteApi("/_authed/_shell/marketplace")

const matches = (app: { name: string; description: string }, query: string) =>
  `${app.name} ${app.description}`.toLowerCase().includes(query.trim().toLowerCase())

function useMarketplacePage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const page = currentPage(search)
  const catalog = useCatalog()
  const spaces = useSpaces()
  const [view, setView] = useState("browse")
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const registry = useQuery({
    ...api["app-registry"].list.queryOptions({ page, pageSize, ...(needle && { query: needle }) }),
    placeholderData: keepPreviousData,
  })
  const browse = (registry.data?.items ?? []).map(fromRegistry)
  const inUse = catalog.apps.filter((app) => catalog.profilesOf(app.id).length > 0)
  return {
    page,
    total: view === "browse" ? (registry.data?.total ?? 0) : 0,
    loading: view === "browse" ? registry.isPending : catalog.loading,
    view,
    setView: (next: string) => {
      setView(next)
      void navigate({ search: {} })
    },
    query,
    setQuery,
    inUse,
    rows: view === "browse" ? browse : inUse.filter((app) => matches(app, query)),
    appOf: (appId: string) => browse.find((app) => app.id === appId) ?? catalog.appOf(appId),
    profilesOf: catalog.profilesOf,
    members: (spaceId: string) => spaces.space(spaceId)?.memberCount ?? 1,
  }
}

export function MarketplacePage() {
  const page = useMarketplacePage()
  const view = page.view
  const query = page.query
  const [opened, setOpened] = useState<string>()
  const [profile, setProfile] = useState<ProfileTarget>()
  const inUse = page.inUse
  const rows = page.rows
  const profilesOf = page.profilesOf
  const app = opened ? page.appOf(opened) : undefined
  const added: Added = (added) =>
    setProfile({
      appId: added.app.id,
      profileId: added.profileId,
      from: {
        spaceId: added.space.id,
        name: added.space.name,
        members: page.members(added.space.id),
      },
    })
  return (
    <Page
      title="Marketplace"
      description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      leading={
        <Tabs value={view} onValueChange={(value: string) => page.setView(value)}>
          <PageTabsList>
            <PageTabsTrigger value="browse">Browse</PageTabsTrigger>
            <PageTabsTrigger value="in-use" count={inUse.length}>
              In use
            </PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
      actions={<ToolbarSearch label="Search apps" value={query} onChange={page.setQuery} />}
      footer={<ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="app" />}
    >
      {page.loading ? (
        <SkeletonRows count={6} />
      ) : rows.length === 0 ? (
        <EmptyState>{query ? `Nothing matches “${query.trim()}”` : "No apps in use"}</EmptyState>
      ) : (
        <AppGrid label="Apps">
          {rows.map((each) => {
            const profiles = profilesOf(each.id)
            return (
              <AppRow
                key={each.id}
                name={each.name}
                icon={each.icon}
                caption={each.description}
                status={profiles.length > 0 ? summary(profiles) : undefined}
                attention={needsAttention(profiles)}
                onOpen={() => setOpened(each.id)}
                action={<AddToSpace app={each} onAdded={added} />}
              />
            )
          })}
        </AppGrid>
      )}
      <AppSheet
        app={app}
        action={app ? <AddToSpace app={app} primary onAdded={added} /> : null}
        onClose={() => setOpened(undefined)}
      >
        {app ? (
          <AccountList
            title="Accounts"
            profiles={profilesOf(app.id)}
            caption={audience}
            action={(each) => (
              <Button variant="outline" size="sm" onClick={() => setProfile({ appId: each.appId, profileId: each.id })}>
                {connectLabel(each) ?? "Open"}
              </Button>
            )}
          />
        ) : null}
      </AppSheet>
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </Page>
  )
}
