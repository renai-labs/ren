export * as Artifacts from "./artifacts.js"

import { queryOptions } from "@tanstack/react-query"
import type { ArtifactInfo, Ren } from "../generated/index.js"

const pageSize = 100

const refreshEvery = 5000

const allKey = (spaceId?: string) =>
  spaceId ? (["artifact", "all", { spaceId }] as const) : (["artifact", "all"] as const)

export const allOptions = (client: ReturnType<typeof Ren.make>, spaceId?: string) =>
  queryOptions({
    queryKey: allKey(spaceId),
    queryFn: async (context) => {
      const items: ArtifactInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- pages fetched in order until total reached
        const result = await client.artifact.list(
          { ...(spaceId && { spaceId }), page, pageSize },
          { signal: context.signal },
        )
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
    refetchInterval: (query) =>
      query.state.data?.some((artifact) => Boolean(artifact.pendingDeploymentId)) ? refreshEvery : false,
  })

export const host = (url: string | null) => (url ? new URL(url).host : undefined)
