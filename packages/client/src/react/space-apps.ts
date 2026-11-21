export * as SpaceApps from "./space-apps.js"

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { Apps } from "../apps.js"
import type { AppInfo, AppRegistryInfo, SpaceInfo } from "../generated/index.js"
import type { RenQuery } from "./generated/index.js"
import { Seed } from "./seed.js"

type Api = ReturnType<typeof RenQuery.make>

export function useApps(api: Api, idsOrSlugs: ReadonlyArray<string>) {
  const queryClient = useQueryClient()
  const unique = [...new Set(idsOrSlugs)]
  const listed = unique.map((idOrSlug) =>
    Seed.fromList<AppRegistryInfo>(
      queryClient,
      [api["app-registry"].list.queryKey().slice(0, 1)],
      idOrSlug,
    ).initialData(),
  )
  const queries = useQueries({
    queries: unique.map((idOrSlug) => ({
      ...api.app.get.queryOptions({ idOrSlug }),
      ...Seed.fromList<AppInfo>(queryClient, [api.app.list.queryKey()], idOrSlug),
    })),
  })
  const found = new Map(
    unique.flatMap((idOrSlug, index): ReadonlyArray<readonly [string, Apps.CatalogApp]> => {
      const own = queries[index]?.data
      const registry = listed[index]
      if (own) return [[idOrSlug, { ...Apps.fromApp(own), listing: registry?.listing ?? null }]]
      return registry ? [[idOrSlug, Apps.fromRegistry(registry)]] : []
    }),
  )
  return {
    pending: queries.some((query, index) => !listed[index] && query.isPending),
    of: (idOrSlug: string) => found.get(idOrSlug),
  }
}

export function useSpace(
  api: Api,
  input: {
    readonly spaceId: string | undefined
    readonly space: SpaceInfo | undefined
    readonly appIds?: ReadonlyArray<string>
  },
) {
  const spaceId = input.spaceId
  const space = input.space
  const reach = useQuery({
    ...api["app-profile-reach"].space.profiles.queryOptions({ id: spaceId ?? "" }),
    enabled: Boolean(spaceId),
    refetchOnWindowFocus: "always",
    retry: false,
  })
  const profiles = reach.data?.profiles ?? []
  const apps = useApps(api, [...profiles.map((profile) => profile.appId), ...(input.appIds ?? [])])
  const here = (appId: string) => profiles.filter((profile) => profile.appId === appId)
  return {
    pending: (Boolean(spaceId) && reach.isPending) || apps.pending,
    profiles,
    here,
    app: apps.of,
    status: (appId: string, options?: { managed: boolean }): Apps.Status => {
      const app = apps.of(appId)
      if (app) return Apps.statusOf(app, here(appId))
      return here(appId).length === 0 && options?.managed ? "credits" : Apps.statusOf({ mcps: null }, here(appId))
    },
    from: space && {
      spaceId: space.id,
      name: space.name,
      members: space.memberCount,
      private: space.kind === "private",
    },
    refresh: async (appId: string) => {
      const fresh = (await reach.refetch()).data?.profiles.filter((profile) => profile.appId === appId) ?? []
      return Apps.statusOf(apps.of(appId) ?? { mcps: null }, fresh)
    },
  }
}

const accountsSize = 100

export function useAccounts(api: Api, slugOf: (text: string) => string) {
  const queryClient = useQueryClient()
  const create = useMutation(api["app-profile"].create.mutationOptions())
  const add = async (
    app: Pick<Apps.CatalogApp, "id" | "name">,
    from: Apps.From,
    others: ReadonlyArray<Apps.Profile>,
  ) => {
    const me = await queryClient.query({ ...api.me.get.queryOptions(), staleTime: "static" })
    const name = Apps.defaultName({
      from,
      only: false,
      picked: new Set(),
      spaces: [],
      others,
      app,
      user: me.user.name,
    })
    return create.mutateAsync({
      appId: app.id,
      name,
      slug: Apps.freeSlug(name, new Set(others.map((profile) => profile.slug)), slugOf),
      kind: from.private ? "private" : "shared",
      ...(!from.private && { spaceIds: [from.spaceId] }),
    })
  }
  return {
    add,
    addManaged: async (app: Pick<Apps.CatalogApp, "id" | "name">, from: Apps.From) => {
      const everything = await queryClient.query({
        ...api["app-profile"].list.queryOptions({ page: 1, pageSize: accountsSize }),
        staleTime: 0,
      })
      const others =
        everything.total <= everything.items.length
          ? everything.items.filter((profile) => profile.appId === app.id)
          : (
              await queryClient.query({
                ...api["app-profile"].list.queryOptions({ appId: app.id, page: 1, pageSize: accountsSize }),
                staleTime: 0,
              })
            ).items
      return add(app, from, others)
    },
  }
}
