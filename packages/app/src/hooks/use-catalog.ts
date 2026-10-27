import { useQuery } from "@tanstack/react-query"
import { api, pickerPageSize } from "@/lib/api"
import { fromApp, fromRegistry } from "@/lib/apps"

export function useCatalog() {
  const apps = useQuery(api.app.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const registry = useQuery(api["app-registry"].list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const profiles = useQuery({
    ...api["app-profile"].list.queryOptions({ page: 1, pageSize: pickerPageSize }),
    refetchOnWindowFocus: "always",
  })
  const own = (apps.data?.items ?? []).map(fromApp)
  const listed = (registry.data?.items ?? []).map(fromRegistry)
  const ownById = new Map(own.map((app) => [app.id, app]))
  const listedIds = new Set(listed.map((app) => app.id))
  const catalog = [
    ...listed.map((app) => ownById.get(app.id) ?? app),
    ...own.filter((app) => !listedIds.has(app.id)),
  ]
  const all = profiles.data?.items ?? []
  return {
    loading: apps.isPending || registry.isPending || profiles.isPending,
    apps: catalog,
    profiles: all,
    appOf: (appId: string) => catalog.find((app) => app.id === appId),
    profilesOf: (appId: string) => all.filter((profile) => profile.appId === appId),
  }
}
