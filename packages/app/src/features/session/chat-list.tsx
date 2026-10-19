import { ApplicationShell } from "@ren/ui/application-shell"
import { StateMessage } from "@ren/ui/state-message"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { RouterContext } from "../../lib/router-context.js"

const untitled = "New chat"

export function ChatList() {
  const context = RouterContext.useRouterContext()
  const chats = useQuery(context.api.session.list.queryOptions({ page: 1, pageSize: 50 }))
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const items = chats.data?.items ?? []
  if (chats.isError)
    return (
      <li>
        <StateMessage state="failed" placement="inline" title="Could not load your chats" />
      </li>
    )
  if (items.length === 0)
    return (
      <li>
        <StateMessage
          state="empty"
          placement="inline"
          title="Your conversations will appear here once you start chatting!"
        />
      </li>
    )
  return items.map((chat) => (
    <ApplicationShell.NavigationItem
      key={chat.id}
      current={pathname === `/sessions/${chat.id}`}
      label={chat.title ?? untitled}
      render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
    />
  ))
}
