export * as TaskSearch from "./task-search.js"

import type { TaskListInput } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import type { Task } from "@ren/schema/task"
import { Effect, Schema } from "effect"
import { Preference } from "../../lib/preference.js"
import type { Runtime } from "../../lib/runtime.js"

export const properties = ["status", "priority", "owner", "labels", "due", "created", "updated", "links"] as const
export type Property = (typeof properties)[number]

const actionable: ReadonlyArray<string> = ["todo", "in_progress"] satisfies ReadonlyArray<Task.Status>

const Values = Schema.Array(Schema.String)

export const Filters = Schema.Struct({
  status: Values,
  priority: Values,
  space: Values,
  agent: Values,
  owner: Values,
  label: Values,
  review: Values,
})
export type Filters = typeof Filters.Type

export const defaultFilters: Filters = {
  status: actionable,
  priority: [],
  space: [],
  agent: [],
  owner: [],
  label: [],
  review: [],
}

export const Group = Schema.Literals(["agent", "status"])
export const Sort = Schema.Literals(["created", "priority"])
export const Direction = Schema.Literals(["asc", "desc"])

const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)))

export const SearchParams = Schema.Struct({
  q: lenient(Schema.String),
  filters: lenient(Filters),
  group: lenient(Group),
  sort: lenient(Sort),
  direction: lenient(Direction),
  empty: lenient(Schema.Boolean),
  properties: lenient(Schema.Array(Schema.Literals(properties))),
})
export type SearchParams = typeof SearchParams.Type

const page = { page: 1, pageSize: Pagination.maximumPageSize }

export const listInput = (filters: Filters): TaskListInput => ({
  ...(filters.space.length === 1 && { spaceId: filters.space[0] }),
  ...((filters.status.length === 0 || filters.status.some((status) => !actionable.includes(status))) && {
    includeDone: true,
  }),
  ...page,
})

export const savedFilters = (userId: string, organizationId: string) =>
  Preference.make(`tasks.filters.${userId}.${organizationId}.v1`, Filters, defaultFilters)

export function catalogOptions(api: Runtime.Context["api"]) {
  return [
    api.space.list.queryOptions(page),
    api.agent.list.queryOptions({ ...page, isSubagent: false }),
    api.label.list.queryOptions(page),
  ] as const
}
