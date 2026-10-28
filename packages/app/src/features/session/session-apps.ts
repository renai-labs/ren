export * as SessionApps from "./session-apps.js"

import { Pagination } from "@ren/schema/pagination"
import type { AppMention } from "@ren/ui/app-mention"
import { useQueries } from "@tanstack/react-query"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"

export interface App extends AppMention.App {
  readonly id: string
  readonly description: string
}

const page = { page: 1, pageSize: Pagination.maximumPageSize }

interface Listed {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly icon: string | null
}

const combine = (results: ReadonlyArray<{ readonly data?: { readonly items: ReadonlyArray<Listed> } | undefined }>) => {
  const listed = results.flatMap((result) => result.data?.items ?? [])
  return [...new Map(listed.map((app) => [app.id, app])).values()].map((app): App => ({
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    icon: app.icon,
  }))
}

// oxlint-disable-next-line ren/no-comments -- The organization's apps and the Marketplace's, which a chat can @-mention. combine keeps one array until either list changes, so the transcript rows that read it stay memoized.
export function useMentionable(): ReadonlyArray<App> {
  const context = RouterContext.useRouterContext()
  return useQueries({
    queries: [
      Pages.all((index) => context.api.app.list.queryOptions({ ...page, page: index })),
      Pages.all((index) => context.api["app-registry"].list.queryOptions({ ...page, page: index })),
    ],
    combine,
  })
}
