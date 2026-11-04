export * as AppRegistryPages from "./app-registry.js"

import { infiniteQueryOptions } from "@tanstack/react-query"
import type { Runtime } from "./runtime.js"

const size = 30

export const options = (client: Runtime.Context["client"], query: string) =>
  infiniteQueryOptions({
    queryKey: ["app-registry", "infinite", { query, pageSize: size }] as const,
    queryFn: (context) =>
      client["app-registry"].list(
        { page: context.pageParam, pageSize: size, ...(query && { query }) },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 60_000,
  })
