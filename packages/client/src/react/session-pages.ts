export * as SessionPages from "./session-pages.js"

import { infiniteQueryOptions, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import type { Ren, SessionInfo, SessionListInput, SessionPage } from "../generated/index.js"
import type { RenQuery } from "./generated/index.js"

const pageSize = 30

export type Filter = Omit<SessionListInput, "page" | "pageSize">

export const keys = {
  all: () => ["session", "infinite"] as const,
  filtered: (input: Filter & { readonly pageSize: number }) => ["session", "infinite", input] as const,
}

export const own = (userId: string): Filter => ({ createdBy: [userId] })

export const options = (client: ReturnType<typeof Ren.make>, filter: Filter = {}) =>
  infiniteQueryOptions({
    queryKey: keys.filtered({ ...filter, pageSize }),
    queryFn: (context) =>
      client.session.list({ ...filter, page: context.pageParam, pageSize }, { signal: context.signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 30_000,
    refetchInterval: 10_000,
  })

export const patch = (
  queryClient: QueryClient,
  api: ReturnType<typeof RenQuery.make>,
  sessionID: string,
  change: Partial<SessionInfo>,
) => {
  const update = (item: SessionInfo) => (item.id === sessionID ? { ...item, ...change } : item)
  queryClient.setQueriesData<SessionPage>({ queryKey: api.session.list.queryKey() }, (page) =>
    page ? { ...page, items: page.items.map(update) } : page,
  )
  queryClient.setQueriesData<InfiniteData<SessionPage>>({ queryKey: keys.all() }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(update) })) } : data,
  )
  queryClient.setQueriesData<SessionInfo>({ queryKey: api.session.get.queryKey() }, (info) =>
    info ? update(info) : info,
  )
}

export const useLive = (
  api: ReturnType<typeof RenQuery.make>,
  sessionID: string,
  live: { readonly title?: string; readonly status?: SessionInfo["status"] },
) => {
  const queryClient = useQueryClient()
  const title = live.title
  const status = live.status
  useEffect(() => {
    if (!title && !status) return
    patch(queryClient, api, sessionID, { ...(title && { title }), ...(status && { status }) })
  }, [queryClient, api, sessionID, title, status])
}
