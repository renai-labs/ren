export * as AppRegistryPages from "./app-registry.js"

import { Search } from "@ren/schema/search"
import { infiniteQueryOptions, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Apps } from "../apps.js"
import type { Ren } from "../generated/index.js"
import type { RenQuery } from "./generated/index.js"
import { Debounce } from "./debounce.js"

const size = 30

const ownSize = 100

export const options = (client: ReturnType<typeof Ren.make>, query: string, category?: string) =>
  infiniteQueryOptions({
    queryKey: ["app-registry", "infinite", { query, category, pageSize: size }] as const,
    queryFn: (context) =>
      client["app-registry"].list(
        { page: context.pageParam, pageSize: size, ...(query && { search: query }), ...(category && { category }) },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 60_000,
  })

export function useSearch(input: {
  readonly client: ReturnType<typeof Ren.make>
  readonly api: ReturnType<typeof RenQuery.make>
  readonly query: string
  readonly added: ReadonlySet<string>
}) {
  const pages = useInfiniteQuery(options(input.client, Debounce.useValue(input.query.trim(), 200)))
  const apps = useQuery(input.api.app.list.queryOptions({ page: 1, pageSize: ownSize }))
  const listed = (pages.data?.pages ?? []).flatMap((page) => page.items)
  const own = (apps.data?.items ?? [])
    .map(Apps.fromApp)
    .filter((app) => Search.matches(input.query, app.name, app.description))
  const managed = new Set([
    ...listed.filter((app) => app.managed).map((app) => app.id),
    ...own.filter(Apps.hasManaged).map((app) => app.id),
  ])
  return {
    found: [...own, ...listed.map(Apps.fromRegistry)].filter((app) => !input.added.has(app.id)),
    managed: (appId: string) => managed.has(appId),
    loading: pages.isPending || apps.isPending,
    more: pages.hasNextPage,
    loadingMore: pages.isFetchingNextPage,
    loadMore: () => {
      if (!pages.isFetchingNextPage) void pages.fetchNextPage()
    },
  }
}
