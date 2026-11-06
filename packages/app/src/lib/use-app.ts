import type { AppInfo, AppRegistryInfo } from "@ren/client"
import { useQueries } from "@tanstack/react-query"
import { fromApp, fromRegistry, type CatalogApp } from "./apps.js"
import { RouterContext } from "./router-context.js"
import { Seed } from "./seed.js"

export function useApps(idsOrSlugs: ReadonlyArray<string>) {
  const { api, queryClient } = RouterContext.useRouterContext()
  const unique = [...new Set(idsOrSlugs)]
  const listed = unique.map((idOrSlug) =>
    Seed.fromList<AppRegistryInfo>(
      queryClient,
      [api["app-registry"].list.queryKey().slice(0, 1)],
      idOrSlug,
    ).initialData(),
  )
  const queries = useQueries({
    queries: unique.map((idOrSlug, index) => ({
      ...api.app.get.queryOptions({ idOrSlug }),
      ...Seed.fromList<AppInfo>(queryClient, [api.app.list.queryKey()], idOrSlug),
      enabled: listed[index] === undefined,
    })),
  })
  const found = new Map(
    unique.flatMap((idOrSlug, index): ReadonlyArray<readonly [string, CatalogApp]> => {
      const own = queries[index]?.data
      const registry = listed[index]
      if (own) return [[idOrSlug, fromApp(own)]]
      return registry ? [[idOrSlug, fromRegistry(registry)]] : []
    }),
  )
  return {
    pending: queries.some((query, index) => listed[index] === undefined && query.isPending),
    of: (idOrSlug: string) => found.get(idOrSlug),
  }
}

export function useApp(idOrSlug: string | undefined) {
  const apps = useApps(idOrSlug ? [idOrSlug] : [])
  return { app: idOrSlug ? apps.of(idOrSlug) : undefined, pending: apps.pending }
}

const mention = /(?:^|\s)@([a-z0-9][a-z0-9-]*)/giu

export function useMentionedApps(text: string) {
  const slugs = [...text.matchAll(mention)].flatMap((match) => (match[1] ? [match[1].toLowerCase()] : []))
  const apps = useApps(slugs)
  return [...new Set(slugs)].flatMap((slug) => apps.of(slug) ?? [])
}
