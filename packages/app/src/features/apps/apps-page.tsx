import { AppListingSample } from "../../components/app-list.js"
import { Loading } from "@ren/ui/loading"
import { useState, type ReactNode } from "react"
import { EmptyState } from "../../components/empty-state.js"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { IconChevronRight } from "@tabler/icons-react"
import { AppRow, AppSection, SeeAllRow } from "../../components/app-list.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { Page, useShapeId } from "../../components/page.js"
import { ListPagination } from "../../components/list-pagination.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { pageSize, currentPage, pickerPageSize } from "../../lib/pagination.js"
import { fromApp, fromRegistry, isSpaceApp, needsAttention, type CatalogApp } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

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

function AppListing(props: {
  inUse: ReadonlyArray<CatalogApp>
  installed: number
  onAll: () => void
  rest: ReadonlyArray<CatalogApp>
  query: string
  row: (app: CatalogApp) => ReactNode
}) {
  if (props.inUse.length === 0 && props.rest.length === 0)
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
      {props.rest.length > 0 ? <AppSection title="All apps">{props.rest.map(props.row)}</AppSection> : null}
    </div>
  )
}

export function AppsPage() {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const page = currentPage(search)
  const shapeId = useShapeId("apps")
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const registry = useQuery({
    ...api["app-registry"].list.queryOptions({ page, pageSize, ...(needle && { query: needle }) }),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
  const connected = useConnectedApps()
  const browse = (registry.data?.items ?? []).map(fromRegistry)
  const usedApps = connected.apps
  const used = new Set(usedApps.map((app) => app.id))
  const profiles = useAppProfiles([...usedApps, ...browse].map((app) => app.id))
  const loading = registry.isPending || connected.pending
  const navigate = useNavigate()
  const row = (each: CatalogApp) => (
    <AppRow
      key={each.id}
      name={each.name}
      icon={each.icon}
      caption={each.description}
      attention={needsAttention(profiles.of(each.id))}
      onOpen={() => void navigate({ to: "/apps/$appId", params: { appId: each.id } })}
      action={
        <IconChevronRight
          aria-hidden
          className="size-4 text-muted-foreground transition-transform duration-150 ease-out group-hover/item:translate-x-0.5"
        />
      }
    />
  )
  return (
    <Page
      title="Apps"
      description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      actions={<ToolbarSearch label="Search apps" value={query} onChange={setQuery} />}
      footer={<ListPagination page={page} pageSize={pageSize} total={registry.data?.total ?? 0} noun="app" />}
    >
      <Loading id={shapeId} loading={loading} label="Loading apps">
        {loading ? (
          <AppListingSample />
        ) : (
          <AppListing
            inUse={usedApps.filter((each) => matches(each, query))}
            installed={connected.total}
            onAll={connected.loadAll}
            rest={browse.filter((each) => !used.has(each.id))}
            query={query}
            row={row}
          />
        )}
      </Loading>
    </Page>
  )
}
