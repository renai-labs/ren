export * as Runtime from "./runtime.js"

import { ClientError, Ren } from "@ren/client"
import { RenQuery } from "@ren/client/react"
import { hashKey, MutationCache, QueryClient } from "@tanstack/react-query"
import { Page } from "@ren/ui/page"
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "../route-tree.gen.js"
import type { Platform } from "../platform/platform.js"
import { Auth } from "./auth.js"
import { OAuthSearch } from "./oauth-search.js"
import { ProductEvents } from "./product-events.js"

export interface Context {
  readonly platform: Platform.Info
  readonly queryClient: QueryClient
  readonly api: ReturnType<typeof RenQuery.make>
  readonly client: ReturnType<typeof Ren.make>
  readonly auth: Auth.Client
  readonly productEvents: ReturnType<typeof ProductEvents.make>
}

const invalidates: Readonly<Record<string, ReadonlyArray<string>>> = {
  task: ["task", "task-activity", "label"],
  "task-comment": ["task-activity"],
  "space-member": ["space-member", "space"],
  "app-profile": ["app-profile", "app-profile-reach"],
  "app-profile-reach": ["app-profile", "app-profile-reach"],
  credential: ["credential", "app-profile", "app-profile-reach"],
  "credential-connect": ["app-profile", "app-profile-reach"],
  schedule: ["schedule", "schedule-run"],
  "channel-mapping": ["channel-mapping", "channel-connect"],
  chat: [],
}

export function make(platform: Platform.Info) {
  const client = Ren.make({ baseUrl: platform.serverUrl, fetch: platform.fetch })
  const api = RenQuery.make(client)
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        const group = mutation.options.mutationKey?.[0]
        if (typeof group !== "string") return
        const groups = invalidates[group] ?? [group]
        return queryClient.invalidateQueries({
          predicate: (query) => groups.some((name) => name === query.queryKey[0]),
        })
      },
    }),
  })
  queryClient.setQueryDefaults(api.me.get.queryKey(), { staleTime: Number.POSITIVE_INFINITY })
  queryClient.setQueryDefaults(api.chat.models.queryKey(), { staleTime: 10 * 60_000 })
  const analytics = platform.analytics
  if (analytics !== undefined) {
    const me = api.me.get.queryOptions().queryKey
    const meHash = hashKey(me)
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== meHash) return
      const data = queryClient.getQueryData(me)
      if (data !== undefined) analytics.identify(data.user)
    })
  }
  const context: Context = {
    platform,
    queryClient,
    api,
    client,
    auth: Auth.createClient(platform),
    productEvents: ProductEvents.make(platform),
  }
  const router = createRouter({
    routeTree,
    context,
    defaultOnCatch: (error) => {
      if (error instanceof ClientError && (error.reason === "Transport" || error.reason === "UnexpectedStatus")) return
      if (error instanceof Error && "_tag" in error && error.name === error._tag) return
      analytics?.captureException(error)
    },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 200,
    defaultPendingMinMs: 400,
    defaultPendingComponent: Page.Pending,
    scrollRestoration: true,
    basepath: "/app",
    parseSearch: OAuthSearch.parse,
    stringifySearch: OAuthSearch.stringify,
  })
  return { context, router }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof make>["router"]
  }
}
