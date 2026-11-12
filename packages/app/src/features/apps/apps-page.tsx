import { useState, type ReactNode } from "react"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Loading } from "@ren/ui/loading"
import { Tabs } from "@ren/ui/tabs"
import { AddToSpace, type Added } from "../../components/add-to-space.js"
import { AppListingSample, AppRow, AppSection, SeeAllRow } from "../../components/app-list.js"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import { Page, PageTabsList, PageTabsTrigger, useShapeId } from "../../components/page.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { AppRegistryPages } from "../../lib/app-registry.js"
import { categoryLabel, fromApp, fromRegistry, isSpaceApp, needsAttention, type CatalogApp } from "../../lib/apps.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { RouterContext } from "../../lib/router-context.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { useSpaces } from "../../lib/use-spaces.js"

const route = getRouteApi("/_authed/_shell/apps/")

const matches = (app: { name: string; description: string }, query: string) =>
  `${app.name} ${app.description}`.toLowerCase().includes(query.trim().toLowerCase())

function useConnectedApps() {
  const { client } = RouterContext.useRouterContext()
  const spaces = useSpaces().spaces
  const pages = useInfiniteQuery({
    queryKey: ["app", "list", "connected", { pageSize: pickerPageSize }] as const,
    queryFn: (context) =>
      client.app.list(
        { connected: true, page: context.pageParam, pageSize: pickerPageSize },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  })
  const loaded = (pages.data?.pages ?? []).flatMap((page) => page.items).map(fromApp)
  const apps = loaded.filter((app) => !isSpaceApp(app, spaces))
  const rest = (more: boolean): Promise<unknown> =>
    more ? pages.fetchNextPage().then((next) => rest(next.hasNextPage)) : Promise.resolve()
  return {
    apps,
    total: (pages.data?.pages.at(0)?.total ?? 0) - (loaded.length - apps.length),
    pending: pages.isPending,
    loadAll: () => void rest(pages.hasNextPage),
  }
}

function InstalledApps(props: {
  apps: ReadonlyArray<CatalogApp>
  total: number
  onAll: () => void
  row: (app: CatalogApp) => ReactNode
}) {
  const [all, setAll] = useState(false)
  return (
    <AppSection title="Installed" count={props.total}>
      {all || props.total <= 5 ? (
        props.apps.map(props.row)
      ) : (
        <>
          {props.apps.slice(0, 5).map(props.row)}
          <SeeAllRow
            apps={props.apps.slice(5)}
            more={props.total - 5}
            onOpen={() => {
              setAll(true)
              props.onAll()
            }}
          />
        </>
      )}
    </AppSection>
  )
}

function CategoryPills(props: { categories: ReadonlyArray<string>; value: string | undefined }) {
  const navigate = route.useNavigate()
  if (props.categories.length === 0) return null
  return (
    <Tabs
      value={props.value ?? "all"}
      onValueChange={(value: string) =>
        void navigate({ search: value === "all" ? {} : { category: value }, replace: true })
      }
    >
      <PageTabsList className="w-full flex-wrap justify-start gap-y-1.5 group-data-horizontal/tabs:h-auto">
        <PageTabsTrigger value="all">All</PageTabsTrigger>
        {props.categories.map((category) => (
          <PageTabsTrigger key={category} value={category}>
            {categoryLabel(category)}
          </PageTabsTrigger>
        ))}
      </PageTabsList>
    </Tabs>
  )
}

function AppListing(props: {
  inUse: ReadonlyArray<CatalogApp>
  installed: number
  onAll: () => void
  rest: ReadonlyArray<CatalogApp>
  restTitle: string
  query: string
  more: boolean
  onMore: () => void
  fetching: boolean
  row: (app: CatalogApp) => ReactNode
}) {
  if (props.inUse.length === 0 && props.rest.length === 0 && !props.more)
    return <EmptyState>{props.query ? `Nothing matches “${props.query.trim()}”` : "No apps yet"}</EmptyState>
  return (
    <div className="flex flex-col gap-10">
      {props.inUse.length > 0 ? (
        <InstalledApps
          apps={props.inUse}
          total={props.query ? props.inUse.length : props.installed}
          onAll={props.onAll}
          row={props.row}
        />
      ) : null}
      {props.rest.length > 0 ? <AppSection title={props.restTitle}>{props.rest.map(props.row)}</AppSection> : null}
      <LoadMore more={props.more} onMore={props.onMore} />
      {props.fetching ? <AppListingSample /> : null}
    </div>
  )
}

export function AppsPage() {
  const { client } = RouterContext.useRouterContext()
  const category = route.useSearch().category
  const shapeId = useShapeId("apps")
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const all = useInfiniteQuery({ ...AppRegistryPages.options(client, needle), placeholderData: keepPreviousData })
  const filtered = useInfiniteQuery({
    ...AppRegistryPages.options(client, needle, category),
    placeholderData: keepPreviousData,
    enabled: category !== undefined,
  })
  const registry = category ? filtered : all
  const loaded = (pages: typeof all) => (pages.data?.pages ?? []).flatMap((page) => page.items).map(fromRegistry)
  const browse = loaded(registry)
  const categories = [
    ...new Set([
      ...loaded(all).flatMap((app) => Object.values(app.listing?.categories ?? {}).flat()),
      ...(category ? [category] : []),
    ]),
  ].toSorted()
  const connected = useConnectedApps()
  const usedApps = category ? [] : connected.apps
  const used = new Set(usedApps.map((app) => app.id))
  const profiles = useAppProfiles([...connected.apps, ...browse].map((app) => app.id))
  const loading = registry.isPending || connected.pending
  const navigate = useNavigate()
  const spaces = useSpaces()
  const [profile, setProfile] = useState<ProfileTarget>()
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
  const row = (each: CatalogApp) => (
    <AppRow
      key={each.id}
      name={each.name}
      icon={each.icon}
      caption={each.description}
      attention={needsAttention(profiles.of(each.id))}
      onOpen={() => void navigate({ to: "/apps/$appId", params: { appId: each.id } })}
      action={<AddToSpace app={each} onAdded={added} />}
    />
  )
  return (
    <Page
      title="Apps"
      width="wide"
      description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      search={<ToolbarSearch label="Search apps" value={query} onChange={setQuery} />}
    >
      <CategoryPills categories={categories} value={category} />
      <Loading id={shapeId} loading={loading} label="Loading apps">
        {loading ? (
          <AppListingSample />
        ) : (
          <AppListing
            inUse={usedApps.filter((each) => matches(each, query))}
            installed={connected.total}
            onAll={connected.loadAll}
            rest={browse.filter((each) => !used.has(each.id))}
            restTitle={category ? categoryLabel(category) : "All apps"}
            query={query}
            more={registry.hasNextPage}
            onMore={() => {
              if (!registry.isFetchingNextPage) void registry.fetchNextPage()
            }}
            fetching={registry.isFetchingNextPage}
            row={row}
          />
        )}
      </Loading>
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </Page>
  )
}
