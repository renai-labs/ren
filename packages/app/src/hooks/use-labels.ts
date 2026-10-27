import { useSuspenseQuery } from "@tanstack/react-query"
import { api, pickerPageSize } from "@/lib/api"

export function useLabels() {
  return useSuspenseQuery(api.label.list.queryOptions({ page: 1, pageSize: pickerPageSize })).data.items
}
