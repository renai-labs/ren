import { Seed, SpaceApps } from "@ren/client/react"
import type { AppInfo, AppRegistryInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { fromApp } from "./apps.js"
import { RouterContext } from "./router-context.js"

export const useApps = (idsOrSlugs: ReadonlyArray<string>) =>
  SpaceApps.useApps(RouterContext.useRouterContext().api, idsOrSlugs)

export function useApp(idOrSlug: string | undefined) {
  const { api, queryClient } = RouterContext.useRouterContext()
  const query = useQuery({
    ...api.app.get.queryOptions({ idOrSlug: idOrSlug ?? "" }),
    ...Seed.fromList<AppInfo>(queryClient, [api.app.list.queryKey()], idOrSlug ?? ""),
    enabled: idOrSlug !== undefined,
  })
  const listed = idOrSlug
    ? Seed.fromList<AppRegistryInfo>(
        queryClient,
        [api["app-registry"].list.queryKey().slice(0, 1)],
        idOrSlug,
      ).initialData()
    : undefined
  return {
    app: query.data ? { ...fromApp(query.data), listing: listed?.listing ?? null } : undefined,
    pending: idOrSlug !== undefined && query.isPending,
  }
}

const mention = /(?:^|\s)@([a-z0-9][a-z0-9-]*)/giu

export function useMentionedApps(text: string) {
  const slugs = [...text.matchAll(mention)].flatMap((match) => (match[1] ? [match[1].toLowerCase()] : []))
  const apps = useApps(slugs)
  return [...new Set(slugs)].flatMap((slug) => apps.of(slug) ?? [])
}
