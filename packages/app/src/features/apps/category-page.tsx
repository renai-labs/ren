import { useState } from "react"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { Loading } from "@ren/ui/loading"
import { AppsBreadcrumb } from "../../components/app-detail.js"
import { Page, useShapeId } from "../../components/page.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { AppRegistryPages } from "../../lib/app-registry.js"
import { fromRegistry } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"
import { Search } from "../../lib/search.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { AppCategories } from "./app-categories.js"
import { AppGridSample, CatalogList } from "./catalog.js"
import { useAddedProfile, useRegistryApps } from "./use-catalog.js"

export function CategoryPage(props: { slug: string }) {
  const { client } = RouterContext.useRouterContext()
  const category = AppCategories.find(props.slug)
  const shapeId = useShapeId(`category-${category.slug}`)
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const featured = useRegistryApps(category.apps)
  const registry = useInfiniteQuery({
    ...AppRegistryPages.options(client, needle, category.slug),
    placeholderData: keepPreviousData,
  })
  const picked = category.apps.flatMap((slug) => featured.of(slug) ?? [])
  const pickedIds = new Set(picked.map((app) => app.id))
  const apps = [
    ...picked.filter((app) => Search.matches(query, app.name, app.description)),
    ...(registry.data?.pages ?? [])
      .flatMap((page) => page.items)
      .map(fromRegistry)
      .filter((app) => !pickedIds.has(app.id)),
  ]
  const pending = featured.pending || registry.isPending
  const profile = useAddedProfile()
  return (
    <div className="relative flex flex-1 flex-col">
      <div className="absolute top-0 left-0 z-30">
        <AppsBreadcrumb name={category.title} />
      </div>
      <Page
        title={category.title}
        description={category.description}
        width="wide"
        actions={<ToolbarSearch label="Search apps" value={query} onChange={setQuery} />}
      >
        <Loading id={shapeId} loading={pending} label="Loading apps">
          {pending ? (
            <AppGridSample count={Math.max(category.apps.length, 6)} />
          ) : (
            <CatalogList
              label={category.title}
              apps={apps}
              query={query}
              empty={`No apps in ${category.title} yet`}
              more={registry.hasNextPage}
              onMore={() => {
                if (!registry.isFetchingNextPage) void registry.fetchNextPage()
              }}
              fetching={registry.isFetchingNextPage}
              onAdded={profile.added}
            />
          )}
        </Loading>
        {profile.dialog}
      </Page>
    </div>
  )
}
