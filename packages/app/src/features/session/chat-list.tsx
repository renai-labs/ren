import { Session } from "@ren/schema/session"
import { ApplicationShell } from "@ren/ui/application-shell"
import { StateMessage } from "@ren/ui/state-message"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { SessionTitle } from "./session-title.js"

const ChatListStatus = lazy(() =>
  import("./chat-list-status.js").then((module) => ({ default: module.ChatListStatus })),
)

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
      label={SessionTitle.display(chat.title, SessionTitle.untitled)}
      trailing={
        <Suspense fallback={null}>
          <ChatListStatus sessionID={Session.ID.make(chat.id)} busy={chat.status === "busy"} />
        </Suspense>
      }
      render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
    />
  ))
}
