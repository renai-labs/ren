export * as ScheduleQueries from "./schedule-queries.js"

import { Pagination } from "@ren/schema/pagination"
import { Pages } from "../../lib/pages.js"
import type { Runtime } from "../../lib/runtime.js"

export const listOptions = (api: Runtime.Context["api"]) =>
  Pages.all((page) => api.schedule.list.queryOptions({ page, pageSize: Pagination.maximumPageSize }))

export const spaceOptions = (api: Runtime.Context["api"]) =>
  Pages.all((page) => api.space.list.queryOptions({ page, pageSize: Pagination.maximumPageSize, joined: true }))
