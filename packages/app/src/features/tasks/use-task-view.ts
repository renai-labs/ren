import { useSuspenseQuery } from "@tanstack/react-query"
import { sameFilters, type Filters } from "../../components/filter-menu.js"
import { RouterContext } from "../../lib/router-context.js"
import { type TaskSearch, viewsInput } from "../../lib/tasks.js"

const mutable = (filters: Readonly<Record<string, ReadonlyArray<string>>>): Filters =>
  Object.fromEntries(Object.entries(filters).map((entry) => [entry[0], [...entry[1]]]))

export type TaskViewState = ReturnType<typeof useTaskView>

export function useTaskView(props: {
  search: TaskSearch
  spaceId: string | undefined
  setSearch: (update: (previous: TaskSearch) => TaskSearch) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const search = props.search
  const views = useSuspenseQuery(api.view.list.queryOptions(viewsInput(props.spaceId))).data.items.filter(
    (view) => view.isSystem,
  )
  const first = views.at(0)
  const current = views.find((view) => view.id === search.view) ?? first
  const viewFilters = mutable(current?.filters ?? {})
  return {
    views,
    current,
    viewFilters,
    filters: Object.fromEntries(
      Object.entries(mutable(search.filters ?? viewFilters)).filter((entry) => !props.spaceId || entry[0] !== "space"),
    ),
    setFilters: (next: Filters) =>
      props.setSearch((previous) => ({ ...previous, filters: sameFilters(next, viewFilters) ? undefined : next })),
    select: (id: string) => props.setSearch(() => (id === first?.id ? {} : { view: id })),
  }
}
