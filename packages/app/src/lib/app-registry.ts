export * as AppRegistryPages from "./app-registry.js"

import { infiniteQueryOptions } from "@tanstack/react-query"
import { maximumPageSize } from "@ren/schema/pagination"
import type { Runtime } from "./runtime.js"

const size = 30

export const options = (client: Runtime.Context["client"], query: string, category?: string) =>
  infiniteQueryOptions({
    queryKey: ["app-registry", "infinite", { query, category, pageSize: size }] as const,
    queryFn: (context) =>
      client["app-registry"].list(
        { page: context.pageParam, pageSize: size, ...(query && { query }), ...(category && { category }) },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 60_000,
  })

export const bySlugs = (api: Runtime.Context["api"], slugs: ReadonlyArray<string>) =>
  api["app-registry"].list.queryOptions({ slugs: [...slugs].toSorted(), page: 1, pageSize: maximumPageSize })
