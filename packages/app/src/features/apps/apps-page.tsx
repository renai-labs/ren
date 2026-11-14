import { useState } from "react"
import { IconChevronRight } from "@tabler/icons-react"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { Loading } from "@ren/ui/loading"
import { Tabs } from "@ren/ui/tabs"
import { AppListingSample, AppSection } from "../../components/app-list.js"
import { Page, PageTabsList, PageTabsTrigger, useShapeId } from "../../components/page.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { AppRegistryPages } from "../../lib/app-registry.js"
import { fromApp, fromRegistry, type CatalogApp } from "../../lib/apps.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { Search } from "../../lib/search.js"
import { RouterContext } from "../../lib/router-context.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { AppCategories } from "./app-categories.js"
import { CatalogAppRow, CatalogList } from "./catalog.js"
import { useAddSheet, useRegistryApps } from "./use-catalog.js"
import { CategoryPage } from "./category-page.js"

const route = getRouteApi("/_authed/_shell/apps/")

function useOwnApps(options: { connected: boolean }) {
  const { client } = RouterContext.useRouterContext()
  const pages = useInfiniteQuery({
    queryKey: ["app", "list", options.connected ? "connected" : "organization", { pageSize: pickerPageSize }] as const,
    queryFn: (context) =>
      client.app.list(
        { ...(options.connected && { connected: true }), page: context.pageParam, pageSize: pickerPageSize },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  })
  return {
    apps: (pages.data?.pages ?? []).flatMap((page) => page.items).map(fromApp),
    total: pages.data?.pages.at(0)?.total ?? 0,
    pending: pages.isPending,
    more: pages.hasNextPage,
    fetching: pages.isFetchingNextPage,
    onMore: () => {
      if (!pages.isFetchingNextPage) void pages.fetchNextPage()
    },
  }
}

function OwnApps(props: {
  connected: boolean
  title: string
  empty: string
  query: string
  onAdd: (app: CatalogApp) => void
}) {
  const shapeId = useShapeId(props.title)
  const own = useOwnApps({ connected: props.connected })
  const shown = own.apps.filter((app) => Search.matches(props.query, app.name, app.description))
  return (
    <Loading id={shapeId} loading={own.pending} label="Loading apps">
      {own.pending ? (
        <AppListingSample title={props.title} />
      ) : (
        <CatalogList
          label={props.title}
          heading
          count={props.query ? shown.length : own.total}
          apps={shown}
          query={props.query}
          empty={props.empty}
          more={own.more}
          onMore={own.onMore}
          fetching={own.fetching}
          onAdd={props.onAdd}
        />
      )}
    </Loading>
  )
}

function ManagedApps(props: { query: string; onAdd: (app: CatalogApp) => void }) {
  const { api } = RouterContext.useRouterContext()
  const shapeId = useShapeId("managed")
  const registry = useQuery(AppRegistryPages.all(api))
  const apps = (registry.data?.items ?? [])
    .filter((app) => app.managed)
    .map(fromRegistry)
    .filter((app) => Search.matches(props.query, app.name, app.description))
  return (
    <Loading id={shapeId} loading={registry.isPending} label="Loading apps">
      {registry.isPending ? (
        <AppListingSample title="Managed by Ren" />
      ) : (
        <CatalogList
          label="Managed by Ren"
          heading
          apps={apps}
          query={props.query}
          empty="No managed apps yet"
          more={false}
          onMore={() => {}}
          fetching={false}
          onAdd={props.onAdd}
        />
      )}
    </Loading>
  )
}

function AppResults(props: { title: string; query: string; needle: string; onAdd: (app: CatalogApp) => void }) {
  const { client } = RouterContext.useRouterContext()
  const shapeId = useShapeId("results")
  const registry = useInfiniteQuery({
    ...AppRegistryPages.options(client, props.needle),
    placeholderData: keepPreviousData,
  })
  const own = useOwnApps({ connected: false })
  const apps = [
    ...own.apps.filter((app) => Search.matches(props.query, app.name, app.description)),
    ...(registry.data?.pages ?? []).flatMap((page) => page.items).map(fromRegistry),
  ]
  const pending = registry.isPending || own.pending
  return (
    <Loading id={shapeId} loading={pending} label="Loading apps">
      {pending ? (
        <AppListingSample title={props.title} />
      ) : (
        <CatalogList
          label={props.title}
          heading
          apps={apps}
          query={props.query}
          empty="No apps yet"
          more={registry.hasNextPage}
          onMore={() => {
            if (!registry.isFetchingNextPage) void registry.fetchNextPage()
          }}
          fetching={registry.isFetchingNextPage}
          onAdd={props.onAdd}
        />
      )}
    </Loading>
  )
}

function FeaturedApps(props: { onAdd: (app: CatalogApp) => void }) {
  const shapeId = useShapeId("featured")
  const registry = useRegistryApps(AppCategories.featured)
  const sections = AppCategories.list
    .map((category) => ({
      category,
      apps: category.apps.flatMap((slug) => registry.of(slug) ?? []).slice(0, AppCategories.featuredLimit),
    }))
    .filter((section) => section.apps.length > 0)
  if (!registry.pending && sections.length === 0)
    return <AppResults title="All apps" query="" needle="" onAdd={props.onAdd} />
  return (
    <Loading id={shapeId} loading={registry.pending} label="Loading apps">
      <div className="flex flex-col gap-10">
        {registry.pending
          ? AppCategories.list.map((category) => (
              <AppListingSample
                key={category.slug}
                title={category.title}
                count={Math.min(category.apps.length, AppCategories.featuredLimit)}
              />
            ))
          : sections.map((section) => (
              <AppSection
                key={section.category.slug}
                title={section.category.title}
                heading={
                  <Link
                    to="/apps"
                    search={{ category: section.category.slug }}
                    className="group/category inline-flex items-center gap-1 rounded-sm text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {section.category.title}
                    <IconChevronRight className="size-4 text-muted-foreground transition-transform duration-150 ease-out group-hover/category:translate-x-0.5" />
                  </Link>
                }
              >
                {section.apps.map((app) => (
                  <CatalogAppRow key={app.id} app={app} onAdd={props.onAdd} />
                ))}
              </AppSection>
            ))}
      </div>
    </Loading>
  )
}

function AppsHome() {
  const tab = route.useSearch({ select: (search) => search.tab ?? "all" })
  const navigate = route.useNavigate()
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const sheet = useAddSheet()
  return (
    <Page
      title="Apps"
      width="wide"
      description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      actions={<ToolbarSearch label="Search apps" value={query} onChange={setQuery} />}
      tabs={
        <Tabs
          value={tab}
          onValueChange={(value: string) =>
            void navigate({
              search: value === "managed" || value === "organization" || value === "installed" ? { tab: value } : {},
              replace: true,
            })
          }
        >
          <PageTabsList>
            <PageTabsTrigger value="all">All</PageTabsTrigger>
            <PageTabsTrigger value="managed">Managed</PageTabsTrigger>
            <PageTabsTrigger value="organization">Organization</PageTabsTrigger>
            <PageTabsTrigger value="installed">Installed</PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
    >
      {tab === "all" && needle ? <AppResults title="All apps" query={query} needle={needle} onAdd={sheet.add} /> : null}
      {tab === "all" && !needle ? <FeaturedApps onAdd={sheet.add} /> : null}
      {tab === "managed" ? <ManagedApps query={query} onAdd={sheet.add} /> : null}
      {tab === "organization" ? (
        <OwnApps
          connected={false}
          title="Made in your organization"
          empty="No apps made in your organization yet"
          query={query}
          onAdd={sheet.add}
        />
      ) : null}
      {tab === "installed" ? (
        <OwnApps connected title="Installed" empty="No apps installed yet" query={query} onAdd={sheet.add} />
      ) : null}
      {sheet.dialog}
    </Page>
  )
}

export function AppsPage() {
  const category = route.useSearch({ select: (search) => search.category })
  return category ? <CategoryPage key={category} slug={category} /> : <AppsHome />
}
