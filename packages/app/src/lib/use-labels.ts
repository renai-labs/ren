import { useSuspenseQuery } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"

export function useLabels(spaceId?: string) {
  const { api } = RouterContext.useRouterContext()
  const items = useSuspenseQuery(
    api.label.list.queryOptions({ ...(spaceId && { spaceId }), page: 1, pageSize: pickerPageSize }),
  ).data.items
  const seen = new Set<string>()
  return items.filter((label) => {
    const key = label.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
