export * as SessionCache from "./session-cache.js"

import type { SessionInfo, SessionPage } from "@ren/client"
import type { Session } from "@ren/schema/session"
import { useQueryClient } from "@tanstack/react-query"
import type { InfiniteData } from "@tanstack/react-query"
import { useEffect, useEffectEvent } from "react"
import { RouterContext } from "./router-context.js"
import { SessionList } from "./session-list.js"

export interface Live {
  readonly title: string | undefined
  readonly status: Session.Status | undefined
}

function usePatch(sessionID: Session.ID) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  return (patch: Partial<SessionInfo>) => {
    const update = (item: SessionInfo) => (item.id === sessionID ? { ...item, ...patch } : item)
    queryClient.setQueriesData<SessionPage>({ queryKey: context.api.session.list.queryKey() }, (page) =>
      page ? { ...page, items: page.items.map(update) } : page,
    )
    queryClient.setQueriesData<InfiniteData<SessionPage>>({ queryKey: SessionList.sidebarKey }, (data) =>
      data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(update) })) } : data,
    )
    queryClient.setQueriesData<SessionInfo>({ queryKey: context.api.session.get.queryKey() }, (info) =>
      info ? update(info) : info,
    )
  }
}

export function useLive(sessionID: Session.ID, live: Live) {
  const patch = usePatch(sessionID)
  const write = useEffectEvent(() =>
    patch({
      ...(live.title !== undefined && { title: live.title }),
      ...(live.status !== undefined && { status: live.status }),
    }),
  )
  useEffect(() => write(), [sessionID, live.title, live.status])
}
