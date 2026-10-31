import { useState, type ReactNode } from "react"
import { EmptyState } from "../../components/empty-state.js"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { AddToSpace, type Added } from "../../components/add-to-space.js"
import { AccountList, AppRow, AppSection, AppSheet, SeeAllRow } from "../../components/app-list.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { Page, SkeletonRows } from "../../components/page.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { ListPagination } from "../../components/list-pagination.js"
import { useCatalog } from "../../lib/use-catalog.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { pageSize, currentPage } from "../../lib/pagination.js"
import { audience, connectLabel, fromRegistry, needsAttention, type CatalogApp } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const route = getRouteApi("/_authed/_shell/marketplace")

const matches = (app: { name: string; description: string }, query: string) =>
  `${app.name} ${app.description}`.toLowerCase().includes(query.trim().toLowerCase())

function InstalledApps(props: { apps: ReadonlyArray<CatalogApp>; row: (app: CatalogApp) => ReactNode }) {
  const [all, setAll] = useState(false)
  return (
    <AppSection title="Installed" count={props.apps.length}>
      {all || props.apps.length <= 5 ? (
        props.apps.map(props.row)
      ) : (
        <>
          {props.apps.slice(0, 5).map(props.row)}
          <SeeAllRow apps={props.apps.slice(5)} onOpen={() => setAll(true)} />
        </>
      )}
    </AppSection>
  )
}

function AppListing(props: {
  inUse: ReadonlyArray<CatalogApp>
  rest: ReadonlyArray<CatalogApp>
  query: string
  row: (app: CatalogApp) => ReactNode
}) {
  if (props.inUse.length === 0 && props.rest.length === 0)
    return <EmptyState>{props.query ? `Nothing matches “${props.query.trim()}”` : "No apps yet"}</EmptyState>
  return (
    <div className="flex flex-col gap-10">
      {props.inUse.length > 0 ? <InstalledApps apps={props.inUse} row={props.row} /> : null}
      {props.rest.length > 0 ? <AppSection title="All apps">{props.rest.map(props.row)}</AppSection> : null}
    </div>
  )
}

function MarketplaceSheet(props: {
  app: CatalogApp | undefined
  profiles: ReturnType<ReturnType<typeof useCatalog>["profilesOf"]>
  onAdded: Added
  onProfile: (target: ProfileTarget) => void
  onClose: () => void
}) {
  const app = props.app
  return (
    <AppSheet
      app={app}
      action={app ? <AddToSpace app={app} primary onAdded={props.onAdded} /> : null}
      onClose={props.onClose}
    >
      {app ? <AppAccounts profiles={props.profiles} onProfile={props.onProfile} /> : null}
    </AppSheet>
  )
}

function AppAccounts(props: {
  profiles: ReturnType<ReturnType<typeof useCatalog>["profilesOf"]>
  onProfile: (target: ProfileTarget) => void
}) {
  return (
    <AccountList
      title="Accounts"
      profiles={props.profiles}
      caption={audience}
      onOpen={(each) => props.onProfile({ appId: each.appId, profileId: each.id, edit: true })}
      action={(each) => (
        <Button size="sm" onClick={() => props.onProfile({ appId: each.appId, profileId: each.id })}>
          {connectLabel(each) ?? "Open"}
        </Button>
      )}
    />
  )
}

export function MarketplacePage() {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const page = currentPage(search)
  const catalog = useCatalog()
  const spaces = useSpaces()
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const registry = useQuery({
    ...api["app-registry"].list.queryOptions({ page, pageSize, ...(needle && { query: needle }) }),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
  const browse = (registry.data?.items ?? []).map(fromRegistry)
  const usedApps = catalog.apps.filter((app) => catalog.profilesOf(app.id).length > 0)
  const used = new Set(usedApps.map((app) => app.id))
  const navigate = route.useNavigate()
  const opened = search.app
  const setOpened = (app: string | undefined) => void navigate({ search: (previous) => ({ ...previous, app }) })
  const [profile, setProfile] = useState<ProfileTarget>()
  const app = opened ? (browse.find((each) => each.id === opened) ?? catalog.appOf(opened)) : undefined
  const added: Added = (added) =>
    setProfile({
      appId: added.app.id,
      profileId: added.profileId,
      from: {
        spaceId: added.space.id,
        name: added.space.name,
        members: spaces.space(added.space.id)?.memberCount ?? 1,
      },
    })
  const row = (each: CatalogApp) => {
    return (
      <AppRow
        key={each.id}
        name={each.name}
        icon={each.icon}
        caption={each.description}
        attention={needsAttention(catalog.profilesOf(each.id))}
        onOpen={() => setOpened(each.id)}
        action={<AddToSpace app={each} onAdded={added} />}
      />
    )
  }
  return (
    <Page
      title="Marketplace"
      description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      actions={<ToolbarSearch label="Search apps" value={query} onChange={setQuery} />}
      footer={<ListPagination page={page} pageSize={pageSize} total={registry.data?.total ?? 0} noun="app" />}
    >
      {registry.isPending || catalog.loading ? (
        <SkeletonRows count={6} />
      ) : (
        <AppListing
          inUse={usedApps.filter((each) => matches(each, query))}
          rest={browse.filter((each) => !used.has(each.id))}
          query={query}
          row={row}
        />
      )}
      <MarketplaceSheet
        app={app}
        profiles={app ? catalog.profilesOf(app.id) : []}
        onAdded={added}
        onProfile={setProfile}
        onClose={() => setOpened(undefined)}
      />
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </Page>
  )
}
