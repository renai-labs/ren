export * as TaskSearch from "./task-search.js"

import type { Task } from "@ren/schema/task"
import { Effect, Schema } from "effect"
import { Preference } from "../../lib/preference.js"

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
  layout: lenient(Schema.Literals(["list", "board"])),
  q: lenient(Schema.String),
  filters: lenient(Filters),
  group: lenient(Group),
  sort: lenient(Sort),
  direction: lenient(Direction),
  empty: lenient(Schema.Boolean),
  properties: lenient(Schema.Array(Schema.Literals(properties))),
  boardProperties: lenient(Schema.Array(Schema.Literals(properties))),
  selected: lenient(Schema.Array(Schema.String)),
})
export type SearchParams = typeof SearchParams.Type

export const savedFilters = (userId: string, organizationId: string) =>
  Preference.make(`tasks.filters.${userId}.${organizationId}.v1`, Filters, defaultFilters)
