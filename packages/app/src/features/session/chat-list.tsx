import { Session } from "@ren/schema/session"
import { Icon } from "@ren/ui/icon"
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, useSidebar } from "@ren/ui/sidebar"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { SessionList } from "../../lib/session-list.js"
import { SessionTitle } from "./session-title.js"

const ChatListStatus = lazy(() =>
  import("./chat-list-status.js").then((module) => ({ default: module.ChatListStatus })),
)

const skeletons = (count: number) =>
  Array.from({ length: count }, (_, index) => (
    <SidebarMenuItem key={`loading-${index}`} aria-hidden={index > 0}>
      {index === 0 ? <output className="sr-only">Loading chats</output> : null}
      <SidebarMenuSkeleton aria-hidden showIcon />
    </SidebarMenuItem>
  ))

export function ChatList() {
  const context = RouterContext.useRouterContext()
  const chats = useInfiniteQuery(SessionList.sidebarOptions(context.client))
  const open = useParams({ strict: false, select: (params) => params.sessionId })
  const sidebar = useSidebar()
  if (chats.isPending) return skeletons(6)
  if (chats.isError)
    return (
      <li role="alert" className="flex p-2 text-sm text-destructive">
        Could not load your chats
      </li>
    )
  const items = chats.data.pages.flatMap((page) => page.items)
  if (items.length === 0) return <li className="flex p-2 text-sm text-sidebar-foreground">No chats</li>
  return (
    <>
      {items.map((chat) => (
        <SidebarMenuItem key={chat.id}>
          <SidebarMenuButton
            className="group-has-data-[sidebar=menu-badge]/menu-item:pr-7"
            isActive={open === chat.id}
            onClick={() => sidebar.setOpenMobile(false)}
            render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
          >
            <Icon glyph="MessageSquare" />
            <span>{SessionTitle.display(chat.title, SessionTitle.untitled)}</span>
          </SidebarMenuButton>
          <Suspense fallback={null}>
            <ChatListStatus sessionID={Session.ID.make(chat.id)} busy={chat.status === "busy"} />
          </Suspense>
        </SidebarMenuItem>
      ))}
      {chats.hasNextPage ? (
        <li
          aria-hidden
          className="h-px shrink-0"
          ref={(node) => {
            if (node === null) return
            const observer = new IntersectionObserver(
              (entries) => {
                if (entries.some((entry) => entry.isIntersecting) && !chats.isFetchingNextPage)
                  void chats.fetchNextPage()
              },
              { root: node.closest("[data-slot=sidebar-group-content]"), rootMargin: "240px 0px" },
            )
            observer.observe(node)
            return () => observer.disconnect()
          }}
        />
      ) : null}
      {chats.isFetchingNextPage ? skeletons(3) : null}
    </>
  )
}
