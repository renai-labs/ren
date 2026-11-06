import { useQueries, useQuery } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"

export function useAppProfiles(appIds: ReadonlyArray<string>) {
  const { api } = RouterContext.useRouterContext()
  const unique = [...new Set(appIds)]
  const all = useQuery({
    ...api["app-profile"].list.queryOptions({ page: 1, pageSize: pickerPageSize }),
    refetchOnWindowFocus: "always",
  })
  const complete = all.data !== undefined && all.data.total <= all.data.items.length
  const each = useQueries({
    queries: unique.map((appId) => ({
      ...api["app-profile"].list.queryOptions({ appId, page: 1, pageSize: pickerPageSize }),
      enabled: !all.isPending && !complete,
      refetchOnWindowFocus: "always" as const,
    })),
  })
  return {
    pending: all.isPending || (!complete && each.some((query) => query.isPending)),
    of: (appId: string) =>
      complete
        ? all.data.items.filter((profile) => profile.appId === appId)
        : (each[unique.indexOf(appId)]?.data?.items ?? []),
  }
}
