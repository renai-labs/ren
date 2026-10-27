import { infiniteQueryOptions } from "@tanstack/react-query"
import { client } from "@/lib/api"
import { sessionKeys } from "@/lib/chat"

const untitled = "New chat"

const placeholderTitle = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function sessionTitle(title: string | null | undefined, fallback = untitled) {
  if (!title || placeholderTitle.test(title)) return fallback
  return title
}

const sidebarPageSize = 30

export const sidebarSessionsOptions = () =>
  infiniteQueryOptions({
    queryKey: sessionKeys.infinitePage({ pageSize: sidebarPageSize }),
    queryFn: (context) =>
      client.session.list({ page: context.pageParam, pageSize: sidebarPageSize }, { signal: context.signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 30_000,
    refetchInterval: 10_000,
  })
