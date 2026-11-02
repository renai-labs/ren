import { useQuery } from "@tanstack/react-query"
import { allPages } from "./pagination.js"
import { fromApp, fromRegistry } from "./apps.js"
import { RouterContext } from "./router-context.js"

const allKey = (resource: "app" | "app-registry" | "app-profile") => [resource, "all"] as const

export function useCatalog() {
  const { client } = RouterContext.useRouterContext()
  const apps = useQuery({
    queryKey: allKey("app"),
    queryFn: (context) => allPages((page) => client.app.list(page, { signal: context.signal })),
  })
  const registry = useQuery({
    queryKey: allKey("app-registry"),
    queryFn: (context) => allPages((page) => client["app-registry"].list(page, { signal: context.signal })),
  })
  const profiles = useQuery({
    queryKey: allKey("app-profile"),
    queryFn: (context) => allPages((page) => client["app-profile"].list(page, { signal: context.signal })),
    refetchOnWindowFocus: "always",
  })
  const own = (apps.data ?? []).map(fromApp)
  const listed = (registry.data ?? []).map(fromRegistry)
  const ownById = new Map(own.map((app) => [app.id, app]))
  const listedIds = new Set(listed.map((app) => app.id))
  const catalog = [...listed.map((app) => ownById.get(app.id) ?? app), ...own.filter((app) => !listedIds.has(app.id))]
  const all = profiles.data ?? []
  return {
    loading: apps.isPending || registry.isPending || profiles.isPending,
    apps: catalog,
    profiles: all,
    appOf: (appId: string) => catalog.find((app) => app.id === appId),
    profilesOf: (appId: string) => all.filter((profile) => profile.appId === appId),
  }
}
