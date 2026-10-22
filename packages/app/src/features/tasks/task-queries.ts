export * as TaskQueries from "./task-queries.js"

import { Pagination } from "@ren/schema/pagination"
import type { Runtime } from "../../lib/runtime.js"
import { Pages } from "../../lib/pages.js"
import { TaskSearch } from "./task-search.js"

export const listOptions = (api: Runtime.Context["api"], filters: TaskSearch.Filters) => ({
  ...Pages.all((page) =>
    api.task.list.queryOptions({
      ...(filters.space.length === 1 && { spaceId: filters.space[0] }),
      ...((filters.status.length === 0 ||
        filters.status.some((status) => !TaskSearch.defaultFilters.status.includes(status))) && { includeDone: true }),
      page,
      pageSize: Pagination.maximumPageSize,
    }),
  ),
  refetchInterval: 5000,
})

export function catalogOptions(api: Runtime.Context["api"]) {
  return [
    Pages.all((page) => api.space.list.queryOptions({ page, pageSize: Pagination.maximumPageSize })),
    Pages.all((page) => api.agent.list.queryOptions({ page, pageSize: Pagination.maximumPageSize, isSubagent: false })),
    Pages.all((page) => api.label.list.queryOptions({ page, pageSize: Pagination.maximumPageSize })),
  ] as const
}
