export * as MentionSources from "./mention-sources.js"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Apps } from "../apps.js"
import type { RenQuery } from "./generated/index.js"

const searchSize = 25

const ownSize = 100

export interface App {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly icon: string | null
  readonly brandColor: string | null
}

export function useApps(
  api: ReturnType<typeof RenQuery.make>,
  input: { readonly query: string | undefined; readonly mentions: ReadonlyArray<App> },
) {
  const query = input.query
  // ast-grep-ignore: no-nullish-comparison, -- an empty query still searches the registry
  const searchable = query !== undefined
  const own = useQuery(api.app.list.queryOptions({ page: 1, pageSize: ownSize }))
  const found = useQuery({
    ...api["app-registry"].list.queryOptions({ page: 1, pageSize: searchSize, ...(query && { search: query }) }),
    enabled: searchable,
    placeholderData: keepPreviousData,
  })
  const ownApps = (own.data?.items ?? []).map(Apps.fromApp)
  const managed = new Set([
    ...ownApps.filter(Apps.hasManaged).map((app) => app.id),
    ...(found.data?.items ?? []).filter((app) => app.managed).map((app) => app.id),
  ])
  const byId = new Map<string, App>(
    [...ownApps, ...input.mentions, ...(searchable ? (found.data?.items ?? []).map(Apps.fromRegistry) : [])].map(
      (app) => [app.id, app],
    ),
  )
  return {
    byId,
    apps: [...byId.values()],
    searching: searchable && found.isFetching,
    managed: (appId: string) => managed.has(appId),
    mentionOf: (appId: string): App | undefined => {
      const app = byId.get(appId)
      return (
        app && {
          id: app.id,
          slug: app.slug,
          name: app.name,
          description: app.description,
          icon: app.icon,
          brandColor: app.brandColor,
        }
      )
    },
  }
}

export function useRepositories(api: ReturnType<typeof RenQuery.make>, spaceId: string | undefined) {
  const settings = useQuery({
    ...api["space-settings"].get.queryOptions({ idOrSlug: spaceId ?? "" }),
    enabled: Boolean(spaceId),
  })
  return settings.data?.settings.references ?? []
}
