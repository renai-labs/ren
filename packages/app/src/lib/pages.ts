export * as Pages from "./pages.js"

import { Pagination } from "@ren/schema/pagination"
import { queryOptions } from "@tanstack/react-query"
import type { QueryFunction, QueryKey, SkipToken } from "@tanstack/react-query"

export function all<A, K extends QueryKey>(
  options: (page: number) => {
    queryKey: K
    queryFn?: QueryFunction<Pagination.Page<A>, K> | SkipToken
  },
) {
  return queryOptions({
    // ast-grep-ignore: no-query-key-literal -- the generated prefix shares invalidation with individual pages
    queryKey: [...options(1).queryKey, "all"],
    queryFn: async (context) => {
      const read = async (page: number) => {
        const next = options(page)
        if (typeof next.queryFn !== "function") throw new Error("A paginated query needs a query function.")
        return next.queryFn({ ...context, queryKey: next.queryKey })
      }
      const first = await read(1)
      const rest = await Promise.all(
        Array.from({ length: Math.ceil(first.total / first.pageSize) - 1 }, (_, index) => read(index + 2)),
      )
      const items = [first, ...rest].flatMap((result) => result.items)
      return { ...first, items, pageSize: items.length }
    },
  })
}
