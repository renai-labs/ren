export * as Runtime from "./runtime.js"

import type { ChatAtoms } from "@ren/chat"
import { Ren } from "@ren/client"
import { RenQuery } from "@ren/client/react"
import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "../route-tree.gen.js"
import type { Platform } from "../platform/platform.js"
import { Auth } from "./auth.js"
import { Chat } from "./chat.js"

export interface Context {
  readonly platform: Platform.Info
  readonly queryClient: QueryClient
  readonly api: ReturnType<typeof RenQuery.make>
  readonly auth: Auth.Client
  readonly chat: (userId: string) => ChatAtoms.ChatAtoms
}

export function make(platform: Platform.Info) {
  const context: Context = {
    platform,
    queryClient: new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
    }),
    api: RenQuery.make(Ren.make({ baseUrl: platform.serverUrl, fetch: platform.fetch })),
    auth: Auth.createClient(platform),
    chat: Chat.make(platform),
  }
  const router = createRouter({
    routeTree,
    context,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    basepath: "/app",
  })
  return { context, router }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof make>["router"]
  }
}
