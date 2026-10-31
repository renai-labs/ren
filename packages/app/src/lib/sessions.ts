import type { SessionListInput } from "@ren/client"
import { infiniteQueryOptions } from "@tanstack/react-query"
import { sessionKeys } from "./chat.js"
import type { Runtime } from "./runtime.js"

const untitled = "New chat"

const placeholderTitle = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function sessionTitle(title: string | null | undefined, fallback = untitled) {
  if (!title || placeholderTitle.test(title)) return fallback
  return title
}

const sidebarPageSize = 30

export type SessionFilter = Omit<SessionListInput, "page" | "pageSize">

export const ownChats = (userId: string): SessionFilter => ({ createdBy: [userId] })

export const sidebarSessionsOptions = (client: Runtime.Context["client"], filter: SessionFilter = {}) =>
  infiniteQueryOptions({
    queryKey: sessionKeys.infinitePage({ ...filter, pageSize: sidebarPageSize }),
    queryFn: (context) =>
      client.session.list(
        { ...filter, page: context.pageParam, pageSize: sidebarPageSize },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 30_000,
    refetchInterval: 10_000,
  })
