export * as SessionList from "./session-list.js"

import type { Ren } from "@ren/client"
import { infiniteQueryOptions } from "@tanstack/react-query"

const pageSize = 30

export const sidebarKey = ["session", "sidebar", { pageSize }] as const

export function sidebarOptions(client: ReturnType<typeof Ren.make>) {
  return infiniteQueryOptions({
    queryKey: sidebarKey,
    queryFn: (context) => client.session.list({ page: context.pageParam, pageSize }, { signal: context.signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  })
}
