import { Session } from "@ren/schema/session"
import { ApplicationShell } from "@ren/ui/application-shell"
import { Empty, EmptyHeader, EmptyTitle } from "@ren/ui/empty"
import { Text } from "@ren/ui/text"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { SessionTitle } from "./session-title.js"

const ChatListStatus = lazy(() =>
  import("./chat-list-status.js").then((module) => ({ default: module.ChatListStatus })),
)

export function ChatList() {
  const context = RouterContext.useRouterContext()
  const chats = useQuery(context.api.session.list.queryOptions({ page: 1, pageSize: 50 }))
  const open = useParams({ strict: false, select: (params) => params.sessionId })
  if (chats.isPending) return null
  if (chats.isError)
    return (
      <li>
        <Empty role="alert" className="p-2">
          <EmptyHeader>
            <EmptyTitle className="font-normal text-destructive">Could not load your chats</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </li>
    )
  if (chats.data.items.length === 0)
    return (
      <li className="flex p-2">
        <Text purpose="body" tone="secondary" truncation="single-line" element="span">
          No chats
        </Text>
      </li>
    )
  return chats.data.items.map((chat) => (
    <ApplicationShell.NavigationItem
      key={chat.id}
      current={open === chat.id}
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
