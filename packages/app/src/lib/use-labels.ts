import { useSuspenseQuery } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"

export function useLabels() {
  const { api } = RouterContext.useRouterContext()
  return useSuspenseQuery(api.label.list.queryOptions({ page: 1, pageSize: pickerPageSize })).data.items
}
