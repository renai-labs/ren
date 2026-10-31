import { useState } from "react"
import { EmptyState } from "@/components/ren/empty-state"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { AddToSpace, type Added } from "@/components/ren/add-to-space"
import { AccountList, AppRow, AppSection, AppSheet, SeeAllRow } from "@/components/ren/app-list"
import { ToolbarSearch } from "@/components/ren/toolbar-search"
import { Page, SkeletonRows } from "@/components/ren/page"
import { ProfileDialog, type ProfileTarget } from "@/components/ren/profile-dialog"
import { ListPagination } from "@/components/ren/list-pagination"
import { useCatalog } from "@/hooks/use-catalog"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSpaces } from "@/hooks/use-spaces"
import { api, pageSize } from "@/lib/api"
import { audience, connectLabel, fromRegistry, needsAttention, type CatalogApp } from "@/lib/apps"
import { currentPage } from "@/lib/pagination"

const route = getRouteApi("/_authed/_shell/marketplace")

const matches = (app: { name: string; description: string }, query: string) =>
  `${app.name} ${app.description}`.toLowerCase().includes(query.trim().toLowerCase())

function useMarketplacePage() {
  const search = route.useSearch()
  const page = currentPage(search)
  const catalog = useCatalog()
  const spaces = useSpaces()
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const registry = useQuery({
    ...api["app-registry"].list.queryOptions({ page, pageSize, ...(needle && { query: needle }) }),
    placeholderData: keepPreviousData,
  })
  const browse = (registry.data?.items ?? []).map(fromRegistry)
  const inUse = catalog.apps.filter((app) => catalog.profilesOf(app.id).length > 0)
  const used = new Set(inUse.map((app) => app.id))
  return {
    page,
    total: registry.data?.total ?? 0,
    loading: registry.isPending || catalog.loading,
    query,
    setQuery,
    inUse: inUse.filter((app) => matches(app, query)),
    rows: browse.filter((app) => !used.has(app.id)),
    appOf: (appId: string) => browse.find((app) => app.id === appId) ?? catalog.appOf(appId),
    profilesOf: catalog.profilesOf,
    members: (spaceId: string) => spaces.space(spaceId)?.memberCount ?? 1,
  }
}

export function MarketplacePage() {
  const page = useMarketplacePage()
  const query = page.query
  const [opened, setOpened] = useState<string>()
  const [profile, setProfile] = useState<ProfileTarget>()
  const [allInstalled, setAllInstalled] = useState(false)
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
  const row = (each: CatalogApp) => {
    return (
      <AppRow
        key={each.id}
        name={each.name}
        icon={each.icon}
        caption={each.description}
        attention={needsAttention(profilesOf(each.id))}
        onOpen={() => setOpened(each.id)}
        action={<AddToSpace app={each} onAdded={added} />}
      />
    )
  }
  return (
    <Page
      title="Marketplace"
      description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      actions={<ToolbarSearch label="Search apps" value={query} onChange={page.setQuery} />}
      footer={<ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="app" />}
    >
      {page.loading ? (
        <SkeletonRows count={6} />
      ) : (
        <div className="flex flex-col gap-10">
          {inUse.length > 0 ? (
            <AppSection title="Installed" count={inUse.length}>
              {allInstalled || inUse.length <= 5 ? (
                inUse.map(row)
              ) : (
                <>
                  {inUse.slice(0, 5).map(row)}
                  <SeeAllRow apps={inUse.slice(5)} onOpen={() => setAllInstalled(true)} />
                </>
              )}
            </AppSection>
          ) : null}
          {rows.length > 0 ? (
            <AppSection title="All apps">{rows.map(row)}</AppSection>
          ) : inUse.length === 0 ? (
            <EmptyState>{query ? `Nothing matches “${query.trim()}”` : "No apps yet"}</EmptyState>
          ) : null}
        </div>
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
            onOpen={(each) => setProfile({ appId: each.appId, profileId: each.id, edit: true })}
            action={(each) => (
              <Button size="sm" onClick={() => setProfile({ appId: each.appId, profileId: each.id })}>
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
