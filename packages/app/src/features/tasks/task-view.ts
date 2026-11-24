export * as TaskView from "./task-view.js"

import { Schema } from "effect"
import { sameFilters, type Filters } from "../../components/filter-menu.js"
import type { Platform } from "../../platform/platform.js"
import { Preference } from "../../lib/preference.js"
import type { TaskSearch } from "../../lib/tasks.js"

const last = Preference.make(
  "tasks.search.v1",
  Schema.Record(
    Schema.String,
    Schema.Struct({
      view: Schema.optional(Schema.String),
      filters: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
    }),
  ),
  {},
)

const scope = (spaceId: string | undefined) => spaceId ?? "all"

export const restore = (
  storage: Platform.Storage,
  spaceId: string | undefined,
  views: ReadonlyArray<{ readonly id: string }>,
): TaskSearch | undefined => {
  const search = last.read(storage)[scope(spaceId)]
  const view = views.some((known) => known.id === search?.view) ? search?.view : undefined
  const filters = search?.filters
  return view || filters ? { ...(view && { view }), ...(filters && { filters }) } : undefined
}

export const remember = (storage: Platform.Storage, spaceId: string | undefined, search: TaskSearch) =>
  last.write(storage, {
    ...last.read(storage),
    [scope(spaceId)]: {
      ...(search.view && { view: search.view }),
      ...(search.filters && { filters: search.filters }),
    },
  })

export const extrasOf = (filters: Filters, view: Filters): Filters =>
  Object.fromEntries(
    Object.entries(filters).filter(
      (entry) => !sameFilters({ [entry[0]]: entry[1] }, { [entry[0]]: view[entry[0]] ?? [] }),
    ),
  )

export const withExtras = (view: Filters, extras: Filters): Filters => ({
  ...view,
  ...Object.fromEntries(Object.entries(extras).filter((entry) => entry[1].length > 0)),
})
