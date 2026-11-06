import { useQueries, useQuery } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"

export function useAppProfiles(appIds: ReadonlyArray<string>) {
  const { api, queryClient } = RouterContext.useRouterContext()
  const unique = [...new Set(appIds)]
  const allOptions = api["app-profile"].list.queryOptions({ page: 1, pageSize: pickerPageSize })
  const appOptions = (appId: string) =>
    api["app-profile"].list.queryOptions({ appId, page: 1, pageSize: pickerPageSize })
  const all = useQuery({ ...allOptions, refetchOnWindowFocus: "always" })
  const complete = all.data !== undefined && all.data.total <= all.data.items.length
  const each = useQueries({
    queries: unique.map((appId) => ({
      ...appOptions(appId),
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
    load: async (appId: string) => {
      const page = await queryClient.query(allOptions)
      if (page.total <= page.items.length) return page.items.filter((profile) => profile.appId === appId)
      return (await queryClient.query(appOptions(appId))).items
    },
  }
}
